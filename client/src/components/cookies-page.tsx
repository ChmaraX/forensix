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
 * Presentation rules kept: every derived proportion is a reading of recorded
 * flags, never an inference; saved rows and rows recovered from WAL / journal
 * sidecars are separate lists (the Saved / Recovered switch), never sorted
 * together; `absent` / `unavailable` stay worded; and no control here writes,
 * re-runs, or mutates anything — the page only reads the loaded rows back.
 */
import { Cookie, EyeOff, Lock, Search, ShieldCheck } from "lucide-react";
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
import { Badge, badgeColors, type BadgeColor } from "@/components/ui/badge";
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
import type {
  ArtifactConfig,
  CaseCompleteness,
  FieldState,
  Finding,
  PageOf,
} from "../types.js";
import { CompletenessPanel } from "./completeness.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import { FieldStateText } from "./field-state.js";
import {
  AbsentWord,
  fieldBool,
  fieldText,
  fieldUtc,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField, ProfilePicker } from "./filters.js";
import { ErrorRows } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { plural, SectionPanel, TimeCell, WeightLabel } from "./page-kit.js";

/* ------------------------------ data reading ------------------------------ */

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
  readonly created: string | null;
  readonly expires: string | null;
  /** The recorded `value` field as-is; the table decides how much to show. */
  readonly value: FieldState | undefined;
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
    created,
    expires,
    value: finding.fields.value,
    valueSealed: finding.fields.value?.state === "unavailable",
    lifespanDays,
  };
}

/** Reads loaded cookies newest first; more pages load on demand via the footer. */
function useCookies(route: string) {
  const [rows, setRows] = useState<readonly CookieRow[]>([]);
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
      ["sort", "creation-time"],
      ["direction", "desc"],
    ])
      .then((page) => {
        if (cancelled) {
          return;
        }
        setRows(page.items.map(toCookieRow));
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
      ["sort", "creation-time"],
      ["direction", "desc"],
      ["after", cursor],
    ])
      .then((page) => {
        setRows((existing) => [...existing, ...page.items.map(toCookieRow)]);
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

/** Segment hue per SameSite value: more permissive reads warmer, stricter
 *  cooler. Hue is never the only signal — every segment is named and counted
 *  in the legend beside it. */
const SAME_SITE_COLOR: Readonly<Record<string, BadgeColor>> = {
  no_restriction: "amber",
  lax: "blue",
  strict: "green",
  unspecified: "gray",
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
  readonly color: BadgeColor;
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
  const slices = SAME_SITE_ORDER.filter(
    (key) => (counts.get(key) ?? 0) > 0,
  ).map((key) => ({
    key,
    label: SAME_SITE_LABEL[key] ?? key,
    count: counts.get(key) ?? 0,
    color: SAME_SITE_COLOR[key] ?? "gray",
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

interface LifespanBucket {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

function lifespanBuckets(rows: readonly CookieRow[]): {
  readonly buckets: readonly LifespanBucket[];
  readonly dated: number;
} {
  const counts = new Map<string, number>(
    LIFESPAN_BUCKETS.map((bucket) => [bucket.key, 0]),
  );
  let dated = 0;
  for (const row of rows) {
    if (row.lifespanDays === null) {
      continue;
    }
    dated += 1;
    const bucket = LIFESPAN_BUCKETS.find((entry) =>
      entry.test(row.lifespanDays as number),
    );
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
function formatLifespan(days: number | null): string | null {
  if (days === null) {
    return null;
  }
  if (days < 0) {
    return "expired";
  }
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

function percent(part: number, whole: number): string {
  return whole === 0 ? "—" : `${String(Math.round((part / whole) * 100))}%`;
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

/** The four posture figures across the top of the page. */
function PostureStrip({ summary }: { readonly summary: PostureSummary }) {
  const of = (part: number) =>
    `${part.toLocaleString("en-US")} of ${summary.total.toLocaleString("en-US")}`;
  return (
    <MetricBand className="grid-cols-2 xl:grid-cols-4">
      <MetricBandItem
        label="Cookies loaded"
        value={summary.total.toLocaleString("en-US")}
        detail="Rows read for the figures below"
      />
      <MetricBandItem
        label="Secure"
        value={percent(summary.secure, summary.total)}
        detail={`${of(summary.secure)} · Sent only over HTTPS`}
        icon={<ShieldCheck aria-hidden="true" className="size-3.5" />}
        progress={{
          value: summary.secure,
          max: summary.total,
          tone: "success",
        }}
      />
      <MetricBandItem
        label="HttpOnly"
        value={percent(summary.httpOnly, summary.total)}
        detail={`${of(summary.httpOnly)} · Hidden from page scripts`}
        progress={{ value: summary.httpOnly, max: summary.total }}
      />
      <MetricBandItem
        label="Value sealed"
        value={percent(summary.sealed, summary.total)}
        detail={`${of(summary.sealed)} · Encrypted, unreadable offline`}
        icon={<Lock aria-hidden="true" className="size-3.5" />}
        tone="destructive"
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
 * The SameSite exposure bar: a single stacked proportion of the cross-site
 * behaviour Chrome recorded for each cookie, most permissive on the left. The
 * legend carries the word, count, and share for every segment, so no reading
 * depends on the hue alone. Cookies without a recorded SameSite are named
 * under the legend as an explicit figure, never dropped.
 */
function SameSiteCard({ rows }: { readonly rows: readonly CookieRow[] }) {
  const { slices, known } = useMemo(() => sameSiteSlices(rows), [rows]);
  const unknown = rows.length - known;
  return (
    <SectionPanel
      className="h-full"
      title="Cross-site behaviour"
      description="Each cookie's recorded SameSite policy."
    >
      {known === 0 ? (
        <p
          className={cn(
            typeClass("body"),
            "px-4 pt-2 pb-4 text-muted-foreground",
          )}
        >
          No cookie carries a recorded SameSite policy.
        </p>
      ) : (
        <div className="flex flex-col gap-4 px-4 pt-2 pb-4">
          <div
            className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
            role="img"
            aria-label={slices
              .map((slice) => `${slice.label} ${String(slice.count)}`)
              .join(", ")}
          >
            {slices.map((slice) => (
              <span
                key={slice.key}
                className="h-full first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${String((slice.count / known) * 100)}%`,
                  backgroundColor: badgeColors[slice.color],
                }}
              />
            ))}
          </div>
          <ul className="flex flex-col">
            {slices.map((slice) => (
              <li
                key={slice.key}
                className="grid h-9 grid-cols-[auto_minmax(0,1fr)_auto_2.5rem] items-center gap-3 border-b border-border last:border-b-0"
              >
                <span
                  aria-hidden="true"
                  className="size-2 rounded-full"
                  style={{ backgroundColor: badgeColors[slice.color] }}
                />
                <span className="flex min-w-0 items-baseline gap-2">
                  <span
                    className={cn(
                      typeClass("body"),
                      "shrink-0 text-foreground",
                    )}
                  >
                    {slice.label}
                  </span>
                  <span
                    className={cn(
                      typeClass("caption"),
                      "truncate text-muted-foreground",
                    )}
                    title={SAME_SITE_HINT[slice.key]}
                  >
                    {SAME_SITE_HINT[slice.key] ?? ""}
                  </span>
                </span>
                <span
                  className={cn(
                    typeClass("body"),
                    "text-foreground tabular-nums",
                  )}
                  style={{ fontVariationSettings: fontWeights.semibold }}
                >
                  {slice.count.toLocaleString("en-US")}
                </span>
                <span
                  className={cn(
                    typeClass("caption"),
                    "text-right text-muted-foreground tabular-nums",
                  )}
                >
                  {Math.round((slice.count / known) * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {unknown > 0 ? (
        <Footnote>
          {plural(unknown, "cookie", "cookies")} with no recorded SameSite
          policy.
        </Footnote>
      ) : null}
    </SectionPanel>
  );
}

/**
 * The lifespan histogram: how long each cookie was set to live, from its own
 * creation-to-expiry span. Bars are drawn as plain rows (not a chart library)
 * because the buckets are few and fixed; every bar carries its count as a
 * number. Cookies missing a creation or expiry bound are reported as an
 * explicit "no dated span" figure below the bars.
 */
function LifespanCard({ rows }: { readonly rows: readonly CookieRow[] }) {
  const { buckets, dated } = useMemo(() => lifespanBuckets(rows), [rows]);
  const peak = Math.max(...buckets.map((bucket) => bucket.count), 0);
  const undated = rows.length - dated;
  return (
    <SectionPanel
      className="h-full"
      title="Persistence"
      description="How long each cookie was set to live."
    >
      {dated === 0 ? (
        <p
          className={cn(
            typeClass("body"),
            "px-4 pt-2 pb-4 text-muted-foreground",
          )}
        >
          No cookie carries both a creation and an expiry time.
        </p>
      ) : (
        <ul className="flex flex-col px-4 pt-1 pb-3">
          {buckets.map((bucket) => (
            <li
              key={bucket.key}
              className="grid h-8 grid-cols-[4.5rem_minmax(0,1fr)_2rem] items-center gap-3"
            >
              <span
                className={cn(typeClass("caption"), "text-muted-foreground")}
              >
                {bucket.label}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-active">
                <span
                  className={cn(
                    "block h-full rounded-full",
                    bucket.key === "expired"
                      ? "bg-destructive"
                      : "bg-foreground",
                    bucket.count === peak ? "opacity-90" : "opacity-45",
                  )}
                  style={{
                    width:
                      peak === 0 || bucket.count === 0
                        ? "0%"
                        : `${String(Math.max(4, (bucket.count / peak) * 100))}%`,
                  }}
                />
              </span>
              <span
                className={cn(
                  typeClass("body"),
                  "text-right tabular-nums",
                  bucket.count === 0
                    ? "text-muted-foreground"
                    : "text-foreground",
                )}
              >
                {bucket.count.toLocaleString("en-US")}
              </span>
            </li>
          ))}
        </ul>
      )}
      {undated > 0 ? (
        <Footnote>
          {plural(undated, "cookie", "cookies")} with no dated span.
        </Footnote>
      ) : null}
    </SectionPanel>
  );
}

/**
 * The busiest cookie hosts. Each row narrows the table to that host (a second
 * click clears it), so the list is a real set of choices and takes FF's fluid
 * hover; the bar is the host's count against the busiest host.
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
  const listRef = useRef<HTMLUListElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();
  return (
    <SectionPanel
      className="h-full"
      title="Cookies by host"
      description="Pick a host to narrow the table."
      aside={
        <Badge size="compact" className="tabular-nums">
          {plural(distinct, "host", "hosts")}
        </Badge>
      }
    >
      {hosts.length === 0 ? (
        <p
          className={cn(
            typeClass("body"),
            "px-4 pt-2 pb-4 text-muted-foreground",
          )}
        >
          No cookie carries a recorded host.
        </p>
      ) : (
        <ul
          ref={listRef}
          {...hover.handlers}
          className="relative flex flex-col px-1 pb-1"
        >
          <FluidHoverHighlight hover={hover} className={shape.item} />
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
        onClick={() => {
          onPick(entry.host);
        }}
        className={cn(
          "relative grid h-9 w-full cursor-pointer grid-cols-[minmax(0,1fr)_5rem_2rem] items-center gap-3 px-3 text-left transition-colors duration-80",
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
        <span className="h-1.5 overflow-hidden rounded-full bg-active">
          <span
            className={cn(
              "block h-full rounded-full bg-foreground",
              entry.count === peak ? "opacity-90" : "opacity-45",
            )}
            style={{
              width:
                peak === 0 ? "0%" : `${String((entry.count / peak) * 100)}%`,
            }}
          />
        </span>
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
function FlagWord({ on }: { readonly on: boolean | null }) {
  if (on === null) {
    return <AbsentWord />;
  }
  return on ? <span className="text-foreground">Yes</span> : <span>No</span>;
}

/**
 * The cookie value, redacted by default. The four states stay four words:
 * a recorded value reads "value hidden" (the value exists, and is withheld
 * here) until "Show values" is on; "(empty)", "absent", and "unavailable"
 * with its reason are shown as they are, since none of them carries a secret.
 */
function CookieValueCell({
  field,
  reveal,
}: {
  readonly field: FieldState | undefined;
  readonly reveal: boolean;
}) {
  if (field === undefined) {
    return <AbsentWord />;
  }
  if (field.state === "value" && field.value !== "" && !reveal) {
    return (
      <Tooltip content="A value was recorded. Turn on Show values, or open the row, to read it.">
        <span
          tabIndex={0}
          className="flex cursor-help items-center gap-1.5 whitespace-nowrap"
        >
          <EyeOff aria-hidden="true" className="size-3.5 shrink-0" />
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
    <div className="scroll-fade-x overflow-x-auto px-1 pb-1">
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
        <TableBody>
          {rows.map((row, index) => (
            <TableRow
              key={index}
              index={index}
              tabIndex={0}
              aria-label={`Open cookie ${row.name ?? ""} on ${row.host ?? "unknown host"}`}
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
              <TableCell className="max-w-[220px]">
                {row.host === null ? (
                  <AbsentWord />
                ) : (
                  <span
                    className="block truncate text-foreground"
                    title={row.host}
                  >
                    {row.host}
                  </span>
                )}
              </TableCell>
              <TableCell className="max-w-[220px]">
                {row.name === null ? (
                  <AbsentWord />
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
                <CookieValueCell field={row.value} reveal={reveal} />
              </TableCell>
              <TableCell>
                <FlagWord on={row.secure} />
              </TableCell>
              <TableCell>
                <FlagWord on={row.httpOnly} />
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {row.sameSite === null ? (
                  <AbsentWord />
                ) : (
                  (SAME_SITE_LABEL[row.sameSite] ?? row.sameSite)
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums">
                {row.lifespanDays === null ? (
                  <AbsentWord />
                ) : row.lifespanDays < 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <EvidenceDot state="unavailable" />
                    expired
                  </span>
                ) : (
                  formatLifespan(row.lifespanDays)
                )}
              </TableCell>
              <TableCell>
                <TimeCell utc={row.created} />
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

type View = "saved" | "recovered";

/**
 * The table section: Saved / Recovered as two separate lists (sidecar rows
 * are never sorted in among saved ones), a profile pick when the Case holds
 * more than one, a search, the value-redaction switch, then the rows and the
 * "N shown / Load more" footer.
 */
function CookieListPanel({
  rows,
  cursor,
  loading,
  onLoadMore,
  search,
  onSearch,
  onSelect,
}: {
  readonly rows: readonly CookieRow[];
  readonly cursor: string | null;
  readonly loading: boolean;
  readonly onLoadMore: () => void;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly onSelect: (row: Finding) => void;
}) {
  const [view, setView] = useState<View>("saved");
  const [profileFilter, setProfileFilter] = useState<readonly string[]>([]);
  const [reveal, setReveal] = useState(false);
  const size = useSize("compact");

  const profiles = useMemo(
    () => [...new Set(rows.map((row) => row.finding.profile))].sort(),
    [rows],
  );

  const saved = useMemo(
    () => rows.filter((row) => row.finding.commitState === "committed"),
    [rows],
  );
  const recovered = useMemo(
    () => rows.filter((row) => row.finding.commitState !== "committed"),
    [rows],
  );
  const base = view === "saved" ? saved : recovered;

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    return base.filter((row) => {
      if (
        profileFilter.length > 0 &&
        !profileFilter.includes(row.finding.profile)
      ) {
        return false;
      }
      if (query === "") {
        return true;
      }
      const haystack = [row.host ?? "", row.name ?? "", row.sameSite ?? ""]
        .join("\n")
        .toLocaleLowerCase("en-US");
      return haystack.includes(query);
    });
  }, [base, search, profileFilter]);

  const filtered = visible.length !== base.length;
  const noun = view === "saved" ? "saved" : "recovered";

  return (
    <Panel className="overflow-clip">
      <PanelHeader className="items-center">
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>All loaded cookies</PanelTitle>
          <PanelDescription>
            Saved rows and rows recovered from WAL or journal sidecars are kept
            as separate lists.
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
            <TabsList aria-label="Saved or recovered rows">
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
          <div className={cn("ml-auto flex flex-wrap items-center", size.gap)}>
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
              label="Search loaded cookies"
              placeholder="Search host or name"
              icon={Search}
              value={search}
              onCommit={onSearch}
            />
          </div>
        </div>
      </SizeProvider>

      <div className="border-t border-border">
        {visible.length === 0 ? (
          <EmptyRows
            message={
              filtered
                ? `No ${noun} cookies match this filter.`
                : view === "saved"
                  ? "No saved cookie rows are loaded."
                  : "No cookie rows were recovered from WAL or journal sidecars."
            }
          />
        ) : (
          <CookieTable rows={visible} reveal={reveal} onSelect={onSelect} />
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
            ? `${visible.length.toLocaleString("en-US")} of ${base.length.toLocaleString("en-US")} ${noun} cookies shown`
            : `${plural(base.length, `${noun} cookie`, `${noun} cookies`)} shown`}
          {cursor === null ? "" : " · more available"}
        </p>
        {cursor !== null ? (
          <Button
            variant="tertiary"
            size="compact"
            onClick={onLoadMore}
            loading={loading}
            disabled={loading}
            className="ml-auto"
          >
            Load more
          </Button>
        ) : null}
      </div>
    </Panel>
  );
}

/** Placeholder at the size of the figure strip and the three widgets. */
function CookiesSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-[112px] w-full rounded-xl" />
      <div className="grid grid-cols-12 gap-4">
        <Skeleton className="col-span-12 h-[300px] rounded-xl lg:col-span-4" />
        <Skeleton className="col-span-12 h-[300px] rounded-xl lg:col-span-4" />
        <Skeleton className="col-span-12 h-[300px] rounded-xl lg:col-span-4" />
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
  const list = useCookies(config.route);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");

  const summary = useMemo(() => summarize(list.rows), [list.rows]);

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const pickHost = useCallback((host: string) => {
    setSearch((current) => (current === host ? "" : host));
  }, []);

  const firstLoad = list.loading && list.rows.length === 0;

  return (
    <div className="flex flex-col gap-4">
      <CompletenessPanel
        completeness={completeness}
        artifacts={[config.completenessArtifact]}
      />
      {list.error !== null ? (
        <ErrorRows
          message={list.error}
          onRetry={list.retry}
          className="px-0 py-0"
        />
      ) : !firstLoad && list.rows.length === 0 ? (
        <Panel>
          <EmptyRows
            icon={Cookie}
            title="No cookies"
            message="No Cookies rows in this Case."
          />
        </Panel>
      ) : (
        <div className="reveal-swap">
          <CookiesSkeleton />
          {firstLoad ? null : (
            <div className="flex flex-col gap-4">
              <PostureStrip summary={summary} />

              <div className="grid grid-cols-12 gap-4">
                <div className="col-span-12 lg:col-span-4">
                  <SameSiteCard rows={list.rows} />
                </div>
                <div className="col-span-12 lg:col-span-4">
                  <LifespanCard rows={list.rows} />
                </div>
                <div className="col-span-12 lg:col-span-4">
                  <HostBoardCard
                    rows={list.rows}
                    activeHost={search === "" ? null : search}
                    onPick={pickHost}
                  />
                </div>
              </div>

              <CookieListPanel
                rows={list.rows}
                cursor={list.cursor}
                loading={list.loading}
                onLoadMore={list.loadMore}
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
          title={`Cookie ${fieldText(selected.row.fields.name) ?? ""}`.trim()}
          redactedFields={COOKIE_SECRET_FIELDS}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
