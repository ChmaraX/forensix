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
 * Recovered tabs). Every figure counts the loaded saved cookies only (a
 * floor, "+", while more pages stand). The Case-wide profile pick (the
 * lens) is a server filter: figures, Persistence and lists hold the picked
 * profiles' rows only; the search narrows the loaded lists. A host opens Sites on it (in the table,
 * when Sites lists it). The page only reads rows back.
 */
import { useCallback, useMemo, useState, type ReactNode } from "react";

import { rowRefOf } from "../router.js";
import { useRowSelection, useViewSearch, useViewTab } from "../view-state.js";

import { Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import { ARTIFACT_ICONS, SearchIcon } from "@/lib/app-icons";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import type { FieldState, Finding } from "../types.js";
import { ARTIFACTS } from "../artifacts.js";
import { useCommitStateTotals } from "../count-reads.js";
import type { RowLookupSource } from "../row-lookup.js";
import {
  commitStateStatus,
  type PaginatedList,
  useCommitStateLists,
} from "../use-commit-state-lists.js";
import { CommitStatePage } from "./commit-state-page.js";
import { ChartEmpty, useChartTokens } from "./charts.js";
import { SegmentBar } from "./charts-ready.js";
import { EmptyRows } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import {
  FieldCell,
  fieldBool,
  fieldText,
  fieldUtc,
  SiteAvatar,
  StateWord,
  TwoLineCell,
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
import { ListBlock } from "./list-states.js";
import { MetricBand, MetricBandItem, TooltipFigure } from "./metric-band.js";
import {
  ArtifactEmpty,
  clearSearchAndProfiles,
  emptyCoverageOf,
  EmptyPivot,
  useProfileLens,
} from "./identity-kit.js";
import { SiteHostLink } from "./host-link.js";
import { siteHostKey } from "../site-host-key.js";
import { useArtifactCoverage } from "../case-context.js";
import {
  COOKIE_SECRET_FIELDS,
  RowSheet,
  SEALED_REASON,
  SecretValueCell,
} from "./row-sheet.js";
import {
  CommitStateSplit,
  plural,
  ResponsiveRows,
  SectionPanel,
  TimeCell,
  type RowColumn,
} from "./page-kit.js";
import { Term } from "./term.js";

/* ------------------------------ data reading ------------------------------ */

/** Newest first; each Commit State is its own read (useCommitStateLists). */
/** The list's orders (`SortSelect`), the route's default first. */
const NEWEST_CREATED: SortOption = {
  label: "Created, newest",
  sort: "creation-time",
  direction: "desc",
};
const COOKIE_SORTS: readonly SortOption[] = [
  NEWEST_CREATED,
  { label: "Created, oldest", sort: "creation-time", direction: "asc" },
  {
    label: "Last accessed, newest",
    sort: "last-access-time",
    direction: "desc",
  },
  { label: "Expires, latest", sort: "expires-time", direction: "desc" },
  { label: "Host, A to Z", sort: "host", direction: "asc" },
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
  /** True when `value` is `unavailable` for want of key material (the
   *  encrypted-offline case). Other unavailable reasons are not "sealed". */
  readonly valueSealed: boolean;
  /** Whole days from creation to expiry, or null when a bound is missing. */
  readonly lifespanDays: number | null;
}

/** A cookie host key as Sites keys it (`siteHostKey`: no leading dot, lower
 *  case, `www.` kept), so the cell reads as the host its link opens; the
 *  recorded text when it is no host key. */
function displayHost(hostKey: string | null): string | null {
  if (hostKey === null || hostKey === "") {
    return null;
  }
  return siteHostKey(hostKey) ?? hostKey;
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
    valueSealed:
      finding.fields.value?.state === "unavailable" &&
      finding.fields.value.reason === SEALED_REASON,
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
 * recorded flag as `true` (or, for `sealed`, whose value is unavailable for
 * want of key material): a cookie whose `isSecure` field is absent is never counted
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

/** What each recorded SameSite policy means, for the column header's
 *  tooltip. */
const SAME_SITE_HINT: Readonly<Record<string, string>> = {
  no_restriction: "Sent on every cross-site request.",
  lax: "Sent on top-level navigations only.",
  strict: "Never sent cross-site.",
  unspecified: "No policy set; the browser default applies.",
};

/** The SameSite column header: its tooltip says what each policy means. */
const SAME_SITE_HEADER = (
  <Term label="SameSite">
    {Object.entries(SAME_SITE_HINT).map(([key, hint]) => (
      <span key={key} className="block">
        {SAME_SITE_LABEL[key] ?? key}: {hint}
      </span>
    ))}
  </Term>
);

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

/** Days in an average month (365.25 / 12). */
const MONTH_DAYS = 30.4375;

/**
 * A lifespan in days as words, on the Persistence buckets' boundaries so a
 * row never reads across one: "session" (≤ 1 day), "N days" (under a
 * month), "N months" up to two years - at most "12 months" within a year
 * (the "≤ 1 year" bucket), at least "13 months" past it ("> 1 year") - then
 * "N years" (one decimal).
 */
function formatLifespan(days: number): string {
  if (days <= 1) {
    return "session";
  }
  if (days < 31) {
    return `${String(days)} days`;
  }
  if (days < 730) {
    const months = Math.round(days / MONTH_DAYS);
    const bounded = days <= 365 ? Math.min(12, months) : Math.max(13, months);
    return `${String(bounded)} month${bounded === 1 ? "" : "s"}`;
  }
  const years = Math.floor((days / 365.25) * 10) / 10;
  return `${String(years)} years`;
}

/** A share as a whole percent; the figures only render with rows loaded. */
function percent(part: number, whole: number): string {
  return whole === 0 ? "none" : `${String(Math.round((part / whole) * 100))}%`;
}

/* ------------------------------ page sections ----------------------------- */

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
          <TooltipFigure
            value={percent(summary.secure, summary.total)}
            detail={of(summary.secure, "marked Secure")}
          />
        }
      />
      <MetricBandItem
        label={<Term label="HttpOnly">Hidden from page scripts.</Term>}
        value={
          <TooltipFigure
            value={percent(summary.httpOnly, summary.total)}
            detail={of(summary.httpOnly, "marked HttpOnly")}
          />
        }
      />
      <MetricBandItem
        label={
          <Term label="Sealed">
            Value encrypted with the operating system's key, and the Case was
            analysed without that key, so it cannot be read - the same
            &quot;sealed&quot; as a saved password.
          </Term>
        }
        value={
          <TooltipFigure
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
        <div className="px-4 pt-1 pb-4">
          <SegmentBar
            segments={buckets}
            tokens={tokens}
            unit={{ one: "cookie", many: "cookies" }}
            label="Saved cookies by lifespan"
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

/** The recorded SameSite policy as a word (the header explains them). */
function SameSiteCell({ field }: { readonly field: FieldState | undefined }) {
  const key = fieldText(field);
  if (key === null) {
    return <FieldCell field={field} />;
  }
  return <span>{SAME_SITE_LABEL[key] ?? key}</span>;
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
        <EvidenceDot state="neutral" />
        expired
      </span>
    );
  }
  return <>{formatLifespan(row.lifespanDays)}</>;
}

/**
 * The cookie's host. In the table it opens Sites on that host (the cookie
 * host key keyed as Sites keys it) when Sites lists it; the stacked card is
 * itself a button, so there it stays text.
 */
function HostCell({
  row,
  linked,
}: {
  readonly row: CookieRow;
  readonly linked: boolean;
}): ReactNode {
  if (row.host === null) {
    return <FieldCell field={row.finding.fields.hostKey} />;
  }
  if (!linked) {
    return (
      <span className="block truncate text-foreground" title={row.host}>
        {row.host}
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar host={row.host} />
      <SiteHostLink
        host={fieldText(row.finding.fields.hostKey)}
        className="truncate text-foreground"
      >
        {row.host}
      </SiteHostLink>
    </span>
  );
}

/** The cookie's name (a key, so mono) over its path when that isn't "/". */
function NameCell({ row }: { readonly row: CookieRow }) {
  return (
    <TwoLineCell
      primary={row.finding.fields.name}
      secondary={
        row.path === null || row.path === "/" ? null : row.finding.fields.path
      }
      mono
    />
  );
}

/** A scope flag every row of a list records the same way (all Yes or all
 *  No) - a degenerate column. */
function uniformFlag(
  rows: readonly CookieRow[],
  flag: (row: CookieRow) => boolean | null,
): boolean {
  const first = rows[0];
  if (first === undefined) {
    return false;
  }
  const value = flag(first);
  return value !== null && rows.every((row) => flag(row) === value);
}

/**
 * The table's columns. The State column only shows in the Recovered tab —
 * every saved row would read "saved". A Secure or HttpOnly column that
 * reads the same on every saved row is left out of the Saved tab: its
 * figure above (100% or 0%) already says so, and the sheet keeps the field.
 * Below `sm` a row stacks: host and state on the first line, the cookie
 * name, then value, lifespan and time. Columns with short values have a
 * fixed width, so revealing values or loading rows never shifts them.
 */
function cookieColumns(
  reveal: boolean,
  recovered: boolean,
  omit: { readonly secure: boolean; readonly httpOnly: boolean } = {
    secure: false,
    httpOnly: false,
  },
): readonly RowColumn<CookieRow>[] {
  const columns: RowColumn<CookieRow>[] = [
    {
      key: "host",
      header: "Host",
      className: "max-w-[320px]",
      stack: "lead",
      cell: (row) => <HostCell row={row} linked />,
      stackedCell: (row) => <HostCell row={row} linked={false} />,
    },
    {
      key: "name",
      header: "Cookie",
      className: "w-[160px] max-w-[160px]",
      stack: "title",
      cell: (row) => <NameCell row={row} />,
    },
    {
      key: "value",
      header: "Value",
      // Cookie values are tokens: monospace, at a fixed width.
      className: "w-[160px] max-w-[160px]",
      cell: (row) => (
        <SecretValueCell
          field={row.finding.fields.value}
          reveal={reveal}
          mono
        />
      ),
    },
    ...(omit.secure
      ? []
      : [
          {
            key: "secure",
            header: "Secure",
            className: "w-[88px]",
            stack: "hidden",
            cell: (row) => <FlagCell field={row.finding.fields.isSecure} />,
          } satisfies RowColumn<CookieRow>,
        ]),
    ...(omit.httpOnly
      ? []
      : [
          {
            key: "httpOnly",
            header: "HttpOnly",
            className: "w-[88px]",
            stack: "hidden",
            cell: (row) => <FlagCell field={row.finding.fields.isHttpOnly} />,
          } satisfies RowColumn<CookieRow>,
        ]),
    {
      key: "sameSite",
      header: SAME_SITE_HEADER,
      label: "SameSite",
      className: "w-[104px] whitespace-nowrap",
      stack: "hidden",
      cell: (row) => <SameSiteCell field={row.finding.fields.sameSite} />,
    },
    {
      key: "lifespan",
      header: "Lifespan",
      className: "w-[96px] whitespace-nowrap tabular-nums",
      cell: (row) => <LifespanCell row={row} />,
    },
    {
      key: "created",
      header: "Created (UTC)",
      label: "Created",
      className: "w-[176px] whitespace-nowrap",
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

/** A row's key: its reference (source chain, profile, Commit State), so a
 *  filter never hands one row's memoised cells to another. */
function cookieKey(row: CookieRow, index: number): string {
  return rowRefOf(row.finding) ?? `${row.finding.commitState}-${String(index)}`;
}

function cookieLabel(row: CookieRow): string {
  return `Open cookie ${row.name ?? "with no recorded name"} on ${row.host ?? "a host not recorded"}`;
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
  lensFiltered,
  noun,
  reveal,
  onSelect,
  onClearFilters,
  filteredMessage,
}: {
  readonly list: PaginatedList<Finding>;
  readonly rows: readonly CookieRow[];
  readonly visible: readonly CookieRow[];
  /** The profile pick (a server filter) narrows the list. */
  readonly lensFiltered: boolean;
  readonly noun: "saved" | "recovered";
  readonly reveal: boolean;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
  readonly filteredMessage?: string;
}) {
  const select = useCallback(
    (row: CookieRow) => {
      onSelect(row.finding);
    },
    [onSelect],
  );
  // Degenerate flags are read over every loaded row of the Saved list (not
  // the visible ones), so a filter never adds or drops a column.
  const omit = useMemo(
    () =>
      noun === "saved"
        ? {
            secure: uniformFlag(rows, (row) => row.secure),
            httpOnly: uniformFlag(rows, (row) => row.httpOnly),
          }
        : { secure: false, httpOnly: false },
    [rows, noun],
  );
  const columns = useMemo(
    () => cookieColumns(reveal, noun === "recovered", omit),
    [reveal, noun, omit],
  );
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} cookie`, many: `${noun} cookies` }}
      shown={visible.length}
      filtered={lensFiltered || visible.length !== rows.length}
      filteredMessage={filteredMessage}
      onClearFilters={onClearFilters}
      skeletonRows={3}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved cookies in this Case."
              : "No cookies were recovered from Chrome's temporary database files."
          }
        />
      }
    >
      <ResponsiveRows
        rows={visible}
        columns={columns}
        rowKey={cookieKey}
        rowLabel={cookieLabel}
        onSelect={select}
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
    <div className="flex flex-col gap-5" role="status">
      <span className="sr-only">Loading cookie figures</span>
      <Skeleton className="h-[150px] w-full rounded-xl lg:h-[76px]" />
      <Skeleton className="h-[290px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

const config = ARTIFACTS.cookies;
/** A URL-named row this page has not loaded is read by its reference. */
const ROW_LOOKUP: RowLookupSource = { route: config.route };

export function CookiesPage() {
  const [order, setOrder] = useState<SortOption>(NEWEST_CREATED);
  // The profile pick is the Case-wide lens, applied by the server.
  const lens = useProfileLens();
  const parameters = useMemo<QueryParameters>(
    () => [
      ["sort", order.sort],
      ["direction", order.direction],
      ...lens.parameters,
    ],
    [order, lens.parameters],
  );
  const lists = useCommitStateLists<Finding>(config.route, parameters);
  // Saved / Recovered, the search and the open row live in the URL: Back
  // and a refresh keep them.
  const [view, setView] = useViewTab();
  const [search, setSearch] = useViewSearch();
  // Values open hidden on every visit (never in the URL).
  const [reveal, setReveal] = useState(false);
  const coverage = useArtifactCoverage(config.completenessArtifact);

  const allSaved = useMemo(
    () => lists.saved.rows.map(toCookieRow),
    [lists.saved.rows],
  );
  const allRecovered = useMemo(
    () => lists.recovered.rows.map(toCookieRow),
    [lists.recovered.rows],
  );
  const loadedFindings = useMemo(
    () => [...lists.saved.rows, ...lists.recovered.rows],
    [lists.saved.rows, lists.recovered.rows],
  );
  const sheet = useRowSelection(loadedFindings, ROW_LOOKUP);

  // The lists hold the lens's profiles only (a server filter); the search
  // narrows only the lists.
  const savedRows = allSaved;
  const recoveredRows = allRecovered;
  const summary = useMemo(() => summarize(savedRows), [savedRows]);

  const narrow = useCallback(
    (rows: readonly CookieRow[]) =>
      rows.filter((row) =>
        // Never the value: a search must not reveal a hidden secret.
        matchesSearch(search, [row.host, row.name, row.sameSite]),
      ),
    [search],
  );
  const savedVisible = useMemo(() => narrow(savedRows), [narrow, savedRows]);
  const recoveredVisible = useMemo(
    () => narrow(recoveredRows),
    [narrow, recoveredRows],
  );

  // The tabs read the server's count of each whole list in the lens.
  const totals = useCommitStateTotals("cookie", lens.selected);
  const status = commitStateStatus(
    lists,
    { saved: savedRows.length, recovered: recoveredRows.length },
    totals.state === "ready" ? totals.value : null,
    { filtered: lens.selected.length > 0 },
  );
  // A profile pick that leaves a list empty says so in its own words.
  const filteredMessage =
    lens.words !== null && search.trim() === ""
      ? (noun: string) => `No ${noun} in ${lens.words ?? ""}.`
      : () => undefined;

  return (
    <CommitStatePage
      status={status}
      empty={
        <ArtifactEmpty
          icon={ARTIFACT_ICONS.cookies}
          coverage={emptyCoverageOf(coverage)}
          artifact="Cookies"
          title="No cookies"
          what="cookies"
          pivot={<EmptyPivot page="history">Open History</EmptyPivot>}
        />
      }
      figuresSkeleton={<CookiesSkeleton />}
      figures={
        <div className="flex flex-col gap-5">
          <PostureStrip summary={summary} more={lists.saved.cursor !== null} />
          <LifespanCard rows={savedRows} />
        </div>
      }
      sheet={
        sheet.selected === null ? null : (
          <RowSheet
            selected={sheet.selected}
            title={fieldText(sheet.selected.row.fields.name) ?? "Cookie"}
            redactedFields={COOKIE_SECRET_FIELDS}
            onClose={sheet.close}
          />
        )
      }
    >
      <SectionPanel id="cookies-list" title="All cookies">
        <CommitStateSplit
          value={view}
          onValueChange={setView}
          label="Saved or recovered cookies"
          {...status.split}
          toolbar={
            <>
              <Switch
                label="Show values"
                checked={reveal}
                onToggle={() => {
                  setReveal((value) => !value);
                }}
                className="max-sm:-ml-2.5 sm:mr-2"
              />
              <CompactFilters active={lens.selected.length > 0 ? 1 : 0}>
                <SortSelect
                  id="cookies-sort"
                  options={COOKIE_SORTS}
                  value={sortKeyOf(order)}
                  onChange={setOrder}
                />
                {lens.showPicker ? (
                  <FilterField label="Profiles" htmlFor="cookies-profiles">
                    <ProfilePicker
                      id="cookies-profiles"
                      profiles={lens.options}
                      selected={lens.selected}
                      onChange={lens.setSelected}
                    />
                  </FilterField>
                ) : null}
              </CompactFilters>
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
              rows={allSaved}
              visible={savedVisible}
              lensFiltered={lens.selected.length > 0}
              noun="saved"
              reveal={reveal}
              onSelect={sheet.select}
              onClearFilters={clearSearchAndProfiles}
              filteredMessage={filteredMessage("saved cookies")}
            />
          }
          recovered={
            <CookieList
              list={lists.recovered}
              rows={allRecovered}
              visible={recoveredVisible}
              lensFiltered={lens.selected.length > 0}
              noun="recovered"
              reveal={reveal}
              onSelect={sheet.select}
              onClearFilters={clearSearchAndProfiles}
              filteredMessage={filteredMessage("recovered cookies")}
            />
          }
        />
      </SectionPanel>
    </CommitStatePage>
  );
}
