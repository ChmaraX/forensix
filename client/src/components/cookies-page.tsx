/**
 * The Cookies page.
 *
 * Cookies read as a security-and-scope posture, not a generic evidence dump.
 * Chrome stores far more per cookie than a name and a value: whether the row
 * is transport-restricted (`isSecure`), script-hidden (`isHttpOnly`), how it
 * behaves cross-site (`sameSite`), and — the one figure an examiner reaches
 * for first here — whether its value could actually be read offline or is
 * still sealed behind OS encryption. The widgets above the table restate
 * exactly those recorded flags as proportions, plus one honest interpolation:
 * a cookie's lifespan, computed from its own `creationTime` and `expiresTime`.
 *
 * Cookie values are session secrets, so the table keeps them **hidden by
 * default**: a recorded value reads as the words "value hidden" until the
 * examiner turns on "Show values"; the row detail sheet keeps it hidden too,
 * behind its own Reveal control (`redactedFields`). A value that could not
 * be decrypted offline reads "unavailable" with its reason, an empty one
 * "(empty)", a missing one "absent" — four distinct words, never a colour
 * alone.
 *
 * Saved rows and rows recovered from WAL / journal sidecars are read as
 * separate server queries (`useCommitStateLists`) and shown as separate lists
 * (the Saved / Recovered switch), never sorted together. Every figure above
 * the table counts the loaded **saved** cookies only, and says so. No control
 * here writes, re-runs, or mutates anything — the page only reads rows back.
 */
import { Cookie, EyeOff, Lock, Search, ShieldCheck } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";

import { Panel } from "@/components/panel";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip } from "@/components/ui/tooltip";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { useShape } from "@/lib/shape-context";
import { typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import type {
  ArtifactConfig,
  CaseCompleteness,
  FieldState,
  Finding,
} from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
import { ChartEmpty, useChartTokens } from "./charts.js";
import { CompletenessPanel } from "./completeness.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import { FieldStateText } from "./field-state.js";
import {
  AbsentWord,
  FieldCell,
  fieldBool,
  fieldText,
  fieldUtc,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField, ProfilePicker } from "./filters.js";
import { ErrorRows, ListFooter, LoadingRows } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import {
  CommitStateSplit,
  MeterList,
  plural,
  SectionPanel,
  ShareBar,
  TimeCell,
  WeightLabel,
  type CommitView,
  type MeterRow,
} from "./page-kit.js";

/* ------------------------------ data reading ------------------------------ */

/** Newest first; each Commit State is its own read (useCommitStateLists). */
const COOKIE_PARAMETERS: QueryParameters = [
  ["sort", "creation-time"],
  ["direction", "desc"],
];

/**
 * One cookie row reduced to just the fields the widgets and the curated table
 * read, computed once so the charts and the table share a single pass. Every
 * property mirrors a recorded flag; `lifespanDays` is the one derived figure —
 * the whole-day distance from `creationTime` to `expiresTime`, and only when
 * both are present, so it is never invented for a row that lacks either bound.
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
 * unavailable): a cookie whose `isSecure` field is absent is never silently
 * counted as insecure, it simply is not in the numerator.
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

/** SameSite reading order: most permissive to most locked-down, then unknown. */
const SAME_SITE_ORDER = [
  "no_restriction",
  "lax",
  "strict",
  "unspecified",
] as const;

const SAME_SITE_LABEL: Readonly<Record<string, string>> = {
  no_restriction: "None",
  lax: "Lax",
  strict: "Strict",
  unspecified: "Unspecified",
};

const SAME_SITE_HINT: Readonly<Record<string, string>> = {
  no_restriction: "Sent on every cross-site request",
  lax: "Sent on top-level navigations only",
  strict: "Never sent cross-site",
  unspecified: "No policy set; the browser default applies",
};

interface SameSiteSlice {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

function sameSiteSlices(rows: readonly CookieRow[]): {
  readonly slices: readonly SameSiteSlice[];
  readonly known: number;
} {
  const counts = new Map<string, number>();
  let known = 0;
  for (const row of rows) {
    if (row.sameSite === null) {
      continue;
    }
    known += 1;
    counts.set(row.sameSite, (counts.get(row.sameSite) ?? 0) + 1);
  }
  const ordered: readonly string[] = SAME_SITE_ORDER;
  const extra = [...counts.keys()].filter((key) => !ordered.includes(key));
  const slices = [...ordered, ...extra.sort()]
    .filter((key) => (counts.get(key) ?? 0) > 0)
    .map((key) => ({
      key,
      label: SAME_SITE_LABEL[key] ?? key,
      count: counts.get(key) ?? 0,
    }));
  return { slices, known };
}

/**
 * Lifespan buckets, derived from each cookie's own creation-to-expiry span.
 * A negative span means the cookie's recorded expiry is already in its past —
 * expired at capture — which is itself evidence, so it gets its own bucket
 * rather than being folded into "session".
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

interface HostTally {
  readonly host: string;
  readonly count: number;
}

/** The busiest cookie hosts, most cookies first, capped for the leaderboard. */
function topHosts(
  rows: readonly CookieRow[],
  limit: number,
): {
  readonly hosts: readonly HostTally[];
  readonly distinct: number;
} {
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (row.host === null) {
      continue;
    }
    counts.set(row.host, (counts.get(row.host) ?? 0) + 1);
  }
  const hosts = [...counts.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((left, right) =>
      right.count === left.count
        ? left.host.localeCompare(right.host)
        : right.count - left.count,
    );
  return { hosts: hosts.slice(0, limit), distinct: counts.size };
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

/** A quiet sentence under a widget — what the figures above leave out. */
function Footnote({ children }: { readonly children: ReactNode }) {
  return (
    <p className={cn(typeClass("caption"), "px-4 pb-4 text-muted-foreground")}>
      {children}
    </p>
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
  const of = (part: number) =>
    `${part.toLocaleString("en-US")} of ${summary.total.toLocaleString("en-US")}`;
  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-4">
      <MetricBandItem
        label="Saved cookies loaded"
        value={`${summary.total.toLocaleString("en-US")}${more ? "+" : ""}`}
        detail="saved rows; recovered listed apart"
      />
      <MetricBandItem
        label="Secure"
        value={percent(summary.secure, summary.total)}
        detail={`${of(summary.secure)} · Sent only over HTTPS`}
        icon={<ShieldCheck aria-hidden="true" />}
        progress={{ value: summary.secure, max: summary.total }}
      />
      <MetricBandItem
        label="HttpOnly"
        value={percent(summary.httpOnly, summary.total)}
        detail={`${of(summary.httpOnly)} · Hidden from page scripts`}
        progress={{ value: summary.httpOnly, max: summary.total }}
      />
      <MetricBandItem
        label="Sealed"
        value={percent(summary.sealed, summary.total)}
        detail={`${of(summary.sealed)} · Encrypted, unreadable offline`}
        icon={<Lock aria-hidden="true" />}
        tone="destructive"
        status="unavailable"
        progress={{
          value: summary.sealed,
          max: summary.total,
          tone: "destructive",
        }}
      />
    </MetricBand>
  );
}

/**
 * The SameSite exposure list: the cross-site behaviour Chrome recorded for
 * each saved cookie, most permissive first, as ranked bars. Every row carries
 * the policy word, what it means, the count and the share, so no reading
 * depends on a hue. Cookies without a recorded SameSite are named under the
 * list as an explicit figure, never dropped.
 */
function SameSiteCard({ rows }: { readonly rows: readonly CookieRow[] }) {
  const tokens = useChartTokens();
  const { slices, known } = useMemo(() => sameSiteSlices(rows), [rows]);
  const unknown = rows.length - known;
  const meterRows: readonly MeterRow[] = slices.map((slice) => ({
    key: slice.key,
    label: <span className="truncate">{slice.label}</span>,
    value: slice.count,
    display: `${slice.count.toLocaleString("en-US")} · ${String(Math.round((slice.count / known) * 100))}%`,
    title: SAME_SITE_HINT[slice.key],
  }));
  return (
    <SectionPanel
      id="cookies-samesite"
      className="h-full"
      title="Cross-site behaviour"
      description="Each saved cookie's recorded SameSite policy."
    >
      {known === 0 ? (
        <ChartEmpty>
          No saved cookie carries a recorded SameSite policy.
        </ChartEmpty>
      ) : (
        <div className="flex flex-col gap-1 px-4 pt-1 pb-3">
          <MeterList rows={meterRows} tokens={tokens} labelWidth="6rem" />
          <ul
            className={cn(typeClass("caption"), "text-muted-foreground")}
            aria-label="What each policy means"
          >
            {slices.map((slice) => (
              <li key={slice.key} className="truncate">
                <span className="text-foreground">{slice.label}</span>:{" "}
                {SAME_SITE_HINT[slice.key] ?? "Policy recorded as is"}
              </li>
            ))}
          </ul>
        </div>
      )}
      {unknown > 0 ? (
        <Footnote>
          {plural(unknown, "saved cookie", "saved cookies")} with no recorded
          SameSite policy.
        </Footnote>
      ) : null}
    </SectionPanel>
  );
}

/**
 * The lifespan list: how long each saved cookie was set to live, from its
 * own creation-to-expiry span, as ranked bars on fixed buckets. Every bar
 * carries its count as a number, and the expired bucket keeps its word.
 * Cookies missing a creation or expiry bound are reported as an explicit
 * "no dated span" figure below the bars.
 */
function LifespanCard({ rows }: { readonly rows: readonly CookieRow[] }) {
  const tokens = useChartTokens();
  const { buckets, dated } = useMemo(() => lifespanBuckets(rows), [rows]);
  const undated = rows.length - dated;
  return (
    <SectionPanel
      id="cookies-lifespan"
      className="h-full"
      title="Persistence"
      description="How long each saved cookie was set to live."
    >
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
        <Footnote>
          {plural(undated, "saved cookie", "saved cookies")} with no dated span.
        </Footnote>
      ) : null}
    </SectionPanel>
  );
}

/**
 * The busiest saved-cookie hosts. Each row narrows both lists to that host (a
 * second click clears it), so the list is a real set of choices and takes
 * FF's fluid hover; the bar is the host's count against the busiest host.
 */
function HostBoardCard({
  rows,
  activeHost,
  onPick,
}: {
  readonly rows: readonly CookieRow[];
  readonly activeHost: string | null;
  readonly onPick: (host: string) => void;
}) {
  const { hosts, distinct } = useMemo(() => topHosts(rows, 6), [rows]);
  const peak = hosts[0]?.count ?? 0;
  const listRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();
  return (
    <SectionPanel
      id="cookies-hosts"
      className="h-full"
      title="Cookies by host"
      description="Saved cookies per host. Pick one to narrow the lists."
      aside={
        <Badge size="compact" className="tabular-nums">
          {plural(distinct, "host", "hosts")}
        </Badge>
      }
    >
      {hosts.length === 0 ? (
        <ChartEmpty>No saved cookie carries a recorded host.</ChartEmpty>
      ) : (
        <div ref={listRef} {...hover.handlers} className="relative px-1 pb-1">
          <FluidHoverHighlight hover={hover} className={shape.item} />
          <ul className="flex flex-col">
            {hosts.map((entry, index) => (
              <HostBoardRow
                key={entry.host}
                index={index}
                registerItem={hover.registerItem}
                entry={entry}
                peak={peak}
                active={activeHost === entry.host}
                onPick={onPick}
              />
            ))}
          </ul>
        </div>
      )}
    </SectionPanel>
  );
}

function HostBoardRow({
  index,
  registerItem,
  entry,
  peak,
  active,
  onPick,
}: {
  readonly index: number;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
  readonly entry: HostTally;
  readonly peak: number;
  readonly active: boolean;
  readonly onPick: (host: string) => void;
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
        aria-label={`${entry.host}, ${plural(entry.count, "saved cookie", "saved cookies")}`}
        onClick={() => {
          onPick(entry.host);
        }}
        className={cn(
          "relative grid h-9 w-full cursor-pointer grid-cols-[minmax(0,1fr)_5rem_2rem] items-center gap-3 px-3 text-left outline-none transition-colors duration-80 focus-visible:ring-1 focus-visible:ring-focus-ring",
          shape.item,
          active && "bg-active",
        )}
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <SiteAvatar host={entry.host} />
          <WeightLabel
            text={entry.host}
            active={active}
            className={cn(typeClass("body"), "text-foreground")}
          />
        </span>
        <ShareBar fraction={peak === 0 ? 0 : entry.count / peak} />
        <span
          className={cn(
            typeClass("body"),
            "text-right text-muted-foreground tabular-nums",
          )}
        >
          {entry.count.toLocaleString("en-US")}
        </span>
      </button>
    </li>
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

/**
 * The cookie value, redacted by default. The four states stay four words:
 * a recorded value reads "value hidden" (the value exists, and is withheld
 * here) until "Show values" is on; "(empty)", "absent", and "unavailable"
 * with its reason are shown as they are, since none of them carries a secret.
 * No own tab stop: the row is the focus target and its sheet the reveal.
 */
function CookieValueCell({
  field,
  reveal,
}: {
  readonly field: FieldState | undefined;
  readonly reveal: boolean;
}) {
  const size = useSize();
  if (field === undefined) {
    return <AbsentWord />;
  }
  if (field.state === "value" && field.value !== "" && !reveal) {
    return (
      <Tooltip content="A value was recorded. Turn on Show values, or open the row, to read it.">
        <span className="flex cursor-help items-center gap-1.5 whitespace-nowrap">
          <EyeOff
            aria-hidden="true"
            size={size.icon}
            strokeWidth={1.5}
            className="shrink-0"
          />
          value hidden
        </span>
      </Tooltip>
    );
  }
  return (
    <span className="block max-w-[220px]">
      <FieldStateText field={field} truncate />
    </span>
  );
}

/** Fields the row sheet keeps hidden until revealed (session secrets). */
const COOKIE_SECRET_FIELDS: readonly string[] = ["value"];

const TABLE_COLUMNS = [
  "Host",
  "Cookie",
  "Value",
  "Secure",
  "HttpOnly",
  "SameSite",
  "Lifespan",
  "Created",
  "State",
] as const;

function CookieTable({
  rows,
  reveal,
  onSelect,
}: {
  readonly rows: readonly CookieRow[];
  readonly reveal: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
      <Table className="min-w-[1080px]">
        <TableHeader>
          <TableRow>
            {TABLE_COLUMNS.map((label) => (
              <TableHead key={label} className="whitespace-nowrap">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="reveal-items">
          {rows.map((row, index) => (
            <TableRow
              key={index}
              index={index}
              tabIndex={0}
              aria-label={`Open cookie ${row.name ?? "with no recorded name"} on ${row.host ?? "a host not recorded"}`}
              onClick={() => {
                onSelect(row.finding);
              }}
              onKeyDown={(event) => {
                activateOnKey(event, () => {
                  onSelect(row.finding);
                });
              }}
              className={ROW_FOCUS_CLASS}
            >
              <TableCell className="max-w-[240px]">
                {row.host === null ? (
                  <FieldCell field={row.finding.fields.hostKey} />
                ) : (
                  <span className="flex min-w-0 items-center gap-2.5">
                    <SiteAvatar host={row.host} />
                    <span className="truncate text-foreground" title={row.host}>
                      {row.host}
                    </span>
                  </span>
                )}
              </TableCell>
              <TableCell className="max-w-[220px]">
                {row.name === null ? (
                  <FieldCell field={row.finding.fields.name} />
                ) : (
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
                )}
              </TableCell>
              <TableCell>
                <CookieValueCell
                  field={row.finding.fields.value}
                  reveal={reveal}
                />
              </TableCell>
              <TableCell>
                <FlagCell field={row.finding.fields.isSecure} />
              </TableCell>
              <TableCell>
                <FlagCell field={row.finding.fields.isHttpOnly} />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <FieldCell
                  field={row.finding.fields.sameSite}
                  format={(value) =>
                    SAME_SITE_LABEL[String(value)] ?? String(value)
                  }
                />
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.lifespanDays === null ? (
                  <FieldCell
                    field={
                      fieldUtc(row.finding.fields.creationTime) === null
                        ? row.finding.fields.creationTime
                        : row.finding.fields.expiresTime
                    }
                  />
                ) : row.lifespanDays < 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <EvidenceDot state="warning" />
                    expired
                  </span>
                ) : (
                  formatLifespan(row.lifespanDays)
                )}
              </TableCell>
              <TableCell>
                <TimeCell field={row.finding.fields.creationTime} />
              </TableCell>
              <TableCell>
                <StateWord state={row.finding.commitState} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * One list (saved or recovered): its loading rows, its read error, its empty
 * state, the table, a load-more failure, and the "N shown / Load more"
 * footer. Each list keeps its own pagination.
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
  const firstLoad = list.loading && rows.length === 0;
  if (list.error !== null && rows.length === 0) {
    return (
      <ErrorRows
        title={`The ${noun} cookies could not be loaded.`}
        message={list.error}
        onRetry={list.retry}
      />
    );
  }
  const filtered = visible.length !== rows.length;
  return (
    <>
      <div className="reveal-swap">
        <LoadingRows rows={3} label={`Loading ${noun} cookies`} />
        {firstLoad ? null : visible.length === 0 ? (
          <EmptyRows
            message={
              filtered
                ? `No loaded ${noun} cookies match these filters.`
                : noun === "saved"
                  ? "No saved cookie rows in this Case."
                  : "No cookie rows were recovered from WAL or journal sidecars."
            }
            action={
              filtered ? (
                <Button
                  variant="tertiary"
                  size="compact"
                  onClick={onClearFilters}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : (
          <CookieTable rows={visible} reveal={reveal} onSelect={onSelect} />
        )}
      </div>
      {list.error !== null ? (
        <ErrorRows
          title={`More ${noun} cookies could not be loaded.`}
          message={list.error}
          onRetry={list.cursor === null ? list.retry : list.loadMore}
        />
      ) : null}
      {firstLoad ? null : (
        <ListFooter
          count={visible.length}
          cursor={list.cursor}
          loading={list.loading}
          onLoadMore={list.loadMore}
          summary={
            filtered
              ? `${visible.length.toLocaleString("en-US")} of ${plural(rows.length, `loaded ${noun} cookie`, `loaded ${noun} cookies`)} shown`
              : `${plural(rows.length, `${noun} cookie`, `${noun} cookies`)} shown`
          }
        />
      )}
    </>
  );
}

/** Placeholder at the size of the figure strip and the three widgets. */
function CookiesSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading cookie figures"
    >
      <Skeleton className="h-[180px] w-full rounded-xl lg:h-[98px]" />
      <div className="grid grid-cols-12 gap-4">
        <Skeleton className="col-span-12 h-[290px] rounded-xl lg:col-span-4" />
        <Skeleton className="col-span-12 h-[290px] rounded-xl lg:col-span-4" />
        <Skeleton className="col-span-12 h-[290px] rounded-xl lg:col-span-4" />
      </div>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function CookiesPage({
  config,
  completeness,
}: {
  readonly config: ArtifactConfig;
  readonly completeness: CaseCompleteness;
}) {
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

  const pickHost = useCallback((host: string) => {
    setSearch((current) => (current === host ? "" : host));
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
      <CompletenessPanel
        completeness={completeness}
        artifacts={[config.completenessArtifact]}
      />
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={Cookie}
            title="No cookies"
            message="No Cookies rows in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <div className="reveal-swap">
              <CookiesSkeleton />
              {savedFirst ? null : (
                <div className="flex flex-col gap-5">
                  <PostureStrip
                    summary={summary}
                    more={lists.saved.cursor !== null}
                  />
                  <div className="grid grid-cols-12 gap-4">
                    <div className="col-span-12 lg:col-span-4">
                      <SameSiteCard rows={savedRows} />
                    </div>
                    <div className="col-span-12 lg:col-span-4">
                      <LifespanCard rows={savedRows} />
                    </div>
                    <div className="col-span-12 lg:col-span-4">
                      <HostBoardCard
                        rows={savedRows}
                        activeHost={search === "" ? null : search}
                        onPick={pickHost}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          <SectionPanel
            id="cookies-list"
            title="All cookies"
            description="Saved rows and rows recovered from WAL or journal sidecars are separate lists."
          >
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
                    icon={Search}
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
