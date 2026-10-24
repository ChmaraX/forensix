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
 * Presentation rules kept: the Completeness Statement ("Evidence coverage")
 * renders before any row; every derived proportion is a reading of recorded
 * flags, never an inference; `absent` / `unavailable` stay worded and are
 * never conveyed by color alone; and no control here writes, re-runs, or
 * mutates anything — the page only reads the loaded rows back.
 */
import { Lock, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type {
  ArtifactConfig,
  FieldState,
  Finding,
  PageOf,
} from "../types.js";
import { EmptyRows } from "./data-table.js";
import {
  AbsentWord,
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
import { Skeleton } from "./ui/misc.js";

/* ------------------------------ data reading ------------------------------ */

/** A `value`-state boolean flag, or null when the field is absent/unavailable. */
function fieldBool(field: FieldState | undefined): boolean | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  return typeof field.value === "boolean" ? field.value : null;
}

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

/** Bar tint per SameSite value: more permissive reads warmer, stricter cooler.
 *  Hue is never the only signal — every segment is labelled in the legend. */
const SAME_SITE_TINT: Readonly<Record<string, string>> = {
  no_restriction: "bg-warning",
  lax: "bg-primary/55",
  strict: "bg-success",
  unspecified: "bg-muted-foreground/45",
};

interface SameSiteSlice {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly tint: string;
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
  const slices = SAME_SITE_ORDER.filter((key) => (counts.get(key) ?? 0) > 0).map(
    (key) => ({
      key,
      label: SAME_SITE_LABEL[key] ?? key,
      count: counts.get(key) ?? 0,
      tint: SAME_SITE_TINT[key] ?? "bg-muted-foreground/45",
    }),
  );
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
function topHosts(rows: readonly CookieRow[], limit: number): {
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

/* -------------------------------- widgets --------------------------------- */

/** The four posture figures across the top of the page. */
function PostureStrip({ summary }: { readonly summary: PostureSummary }) {
  return (
    <MetricBand className="grid-cols-2 xl:grid-cols-4">
      <MetricBandItem
        label="Cookies loaded"
        value={summary.total.toLocaleString("en-US")}
        detail="Rows read for the charts below"
      />
      <MetricBandItem
        label="Secure"
        value={
          summary.total === 0
            ? "—"
            : `${String(Math.round((summary.secure / summary.total) * 100))}%`
        }
        detail={`${summary.secure.toLocaleString("en-US")} of ${summary.total.toLocaleString("en-US")} · Sent only over HTTPS`}
        icon={<ShieldCheck aria-hidden="true" className="size-3.5" />}
        progress={{ value: summary.secure, max: summary.total, tone: "success" }}
      />
      <MetricBandItem
        label="HttpOnly"
        value={
          summary.total === 0
            ? "—"
            : `${String(Math.round((summary.httpOnly / summary.total) * 100))}%`
        }
        detail={`${summary.httpOnly.toLocaleString("en-US")} of ${summary.total.toLocaleString("en-US")} · Hidden from page scripts`}
        progress={{ value: summary.httpOnly, max: summary.total }}
      />
      <MetricBandItem
        label="Value sealed"
        value={
          summary.total === 0
            ? "—"
            : `${String(Math.round((summary.sealed / summary.total) * 100))}%`
        }
        detail={`${summary.sealed.toLocaleString("en-US")} of ${summary.total.toLocaleString("en-US")} · Encrypted, unreadable offline`}
        icon={<Lock aria-hidden="true" className="size-3.5" />}
        tone="destructive"
        progress={{ value: summary.sealed, max: summary.total, tone: "destructive" }}
      />
    </MetricBand>
  );
}

/**
 * The SameSite exposure bar: a single stacked proportion of the cross-site
 * behaviour Chrome recorded for each cookie, most permissive on the left. The
 * legend carries the count and word for every segment, so no reading depends
 * on the tint alone. Cookies without a recorded SameSite are named under the
 * bar as an explicit "not recorded" figure, never dropped.
 */
function SameSiteCard({ rows }: { readonly rows: readonly CookieRow[] }) {
  const { slices, known } = useMemo(() => sameSiteSlices(rows), [rows]);
  const unknown = rows.length - known;
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-col gap-0.5 border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Cross-site behaviour</h2>
        <p className="text-[12px] text-muted-foreground">
          Each cookie's recorded SameSite policy — how it travels between sites.
        </p>
      </header>
      <div className="flex flex-1 flex-col justify-center gap-4 px-4 py-4">
        {known === 0 ? (
          <p className="py-4 text-[13px] text-muted-foreground">
            No cookie carries a recorded SameSite policy.
          </p>
        ) : (
          <>
            <div
              className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
              role="img"
              aria-label="SameSite policy distribution"
            >
              {slices.map((slice) => (
                <span
                  key={slice.key}
                  className={cn("h-full first:rounded-l-full last:rounded-r-full", slice.tint)}
                  style={{ width: `${String((slice.count / known) * 100)}%` }}
                  title={`${slice.label}: ${String(slice.count)}`}
                />
              ))}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-2">
              {slices.map((slice) => (
                <li key={slice.key} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn("size-2.5 shrink-0 rounded-full", slice.tint)}
                  />
                  <span className="text-[12.5px] text-foreground/80">
                    {slice.label}
                  </span>
                  <span className="ml-auto text-[12.5px] font-medium tabular-nums">
                    {slice.count.toLocaleString("en-US")}
                  </span>
                  <span className="w-10 text-right text-[11.5px] text-muted-foreground tabular-nums">
                    {Math.round((slice.count / known) * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {unknown > 0 ? (
          <p className="text-[12px] text-muted-foreground">
            {unknown.toLocaleString("en-US")} cookie
            {unknown === 1 ? "" : "s"} with no recorded SameSite policy.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/**
 * The lifespan histogram: how long each cookie was set to live, from its own
 * creation-to-expiry span. Bars are drawn as CSS rows (not a chart library)
 * because the buckets are few and fixed; every bar carries its count in
 * words. Cookies missing a creation or expiry bound are reported as an
 * explicit "no dated span" figure below the bars.
 */
function LifespanCard({ rows }: { readonly rows: readonly CookieRow[] }) {
  const { buckets, dated } = useMemo(() => lifespanBuckets(rows), [rows]);
  const peak = Math.max(...buckets.map((bucket) => bucket.count), 0);
  const undated = rows.length - dated;
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-col gap-0.5 border-b border-border px-4 py-3">
        <h2 className="text-[13px] font-semibold">Persistence</h2>
        <p className="text-[12px] text-muted-foreground">
          How long each cookie was set to live — expiry minus creation.
        </p>
      </header>
      <div className="flex flex-1 flex-col justify-center gap-2.5 px-4 py-4">
        {dated === 0 ? (
          <p className="py-4 text-[13px] text-muted-foreground">
            No cookie carries both a creation and an expiry time.
          </p>
        ) : (
          buckets.map((bucket) => (
            <div key={bucket.key} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-[12px] text-muted-foreground">
                {bucket.label}
              </span>
              <span className="h-4 flex-1 overflow-hidden rounded-md bg-muted">
                <span
                  className={cn(
                    "block h-full rounded-md transition-[width] duration-500",
                    bucket.key === "expired" ? "bg-destructive/70" : "bg-primary/60",
                  )}
                  style={{
                    width:
                      peak === 0
                        ? "0%"
                        : `${String(Math.max(bucket.count === 0 ? 0 : 6, (bucket.count / peak) * 100))}%`,
                  }}
                />
              </span>
              <span className="w-8 shrink-0 text-right text-[12.5px] font-medium tabular-nums">
                {bucket.count.toLocaleString("en-US")}
              </span>
            </div>
          ))
        )}
        {undated > 0 ? (
          <p className="pt-1 text-[12px] text-muted-foreground">
            {undated.toLocaleString("en-US")} cookie
            {undated === 1 ? "" : "s"} with no dated span.
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** The busiest cookie hosts, as a bar leaderboard sized to the top host. */
function HostBoardCard({ rows }: { readonly rows: readonly CookieRow[] }) {
  const { hosts, distinct } = useMemo(() => topHosts(rows, 6), [rows]);
  const peak = hosts[0]?.count ?? 0;
  return (
    <section className="flex flex-col overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-[13px] font-semibold">Cookies by host</h2>
          <p className="text-[12px] text-muted-foreground">
            Which sites left the most cookies.
          </p>
        </div>
        <span className="ml-auto shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
          {distinct} host{distinct === 1 ? "" : "s"}
        </span>
      </header>
      <div className="flex flex-1 flex-col justify-evenly gap-1 px-3 py-3">
        {hosts.length === 0 ? (
          <p className="px-1 py-4 text-[13px] text-muted-foreground">
            No cookie carries a recorded host.
          </p>
        ) : (
          hosts.map((entry) => (
            <div
              key={entry.host}
              className="grid grid-cols-[minmax(0,150px)_1fr_auto] items-center gap-3 rounded-md px-1.5 py-1.5"
            >
              <span className="flex min-w-0 items-center gap-2">
                <SiteAvatar host={entry.host} />
                <span className="truncate text-[12.5px] font-medium" title={entry.host}>
                  {entry.host}
                </span>
              </span>
              <span className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <span
                  className={cn(
                    "block h-full rounded-full transition-[width] duration-500",
                    entry.count === peak ? "bg-primary" : "bg-primary/45",
                  )}
                  style={{
                    width: peak === 0 ? "0%" : `${String((entry.count / peak) * 100)}%`,
                  }}
                />
              </span>
              <span className="font-mono text-[12px] tabular-nums">
                {entry.count.toLocaleString("en-US")}
              </span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

/* ------------------------------ curated table ----------------------------- */

/** A worded Yes/No/absent for a recorded boolean scope flag. Never color-only. */
function FlagWord({ on }: { readonly on: boolean | null }) {
  if (on === null) {
    return <AbsentWord />;
  }
  return (
    <span
      className={cn(
        "text-[12.5px] tabular-nums",
        on ? "font-medium text-foreground/90" : "text-muted-foreground",
      )}
    >
      {on ? "Yes" : "No"}
    </span>
  );
}

function TimeCell({ utc }: { readonly utc: string | null }) {
  const parts = utc === null ? null : formatInstant(utc);
  if (utc === null || parts === null) {
    return <AbsentWord />;
  }
  return (
    <span className="whitespace-nowrap tabular-nums" title={`${utc} (UTC)`}>
      <span className="text-[12.5px] font-medium">{parts.date}</span>
      <span className="ml-2 text-[12px] text-muted-foreground">
        {parts.time}
      </span>
    </span>
  );
}

const TABLE_COLUMNS = [
  "Host",
  "Cookie",
  "Secure",
  "HttpOnly",
  "SameSite",
  "Lifespan",
  "Created",
  "State",
] as const;

function CookieTable({
  rows,
  onSelect,
}: {
  readonly rows: readonly CookieRow[];
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <div className="fx-scroll-x">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr>
            {TABLE_COLUMNS.map((label) => (
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
          {rows.map((row, index) => (
            <tr
              key={index}
              tabIndex={0}
              aria-label="Open cookie row detail"
              onClick={() => {
                onSelect(row.finding);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(row.finding);
                }
              }}
              className="cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-accent/40"
            >
              <td className="max-w-[200px] px-3 py-2.5">
                <span className="flex items-center gap-2.5">
                  <SiteAvatar host={row.host} />
                  <span
                    className="truncate text-[12.5px] text-foreground/90"
                    title={row.host ?? undefined}
                  >
                    {row.host ?? <AbsentWord />}
                  </span>
                </span>
              </td>
              <td className="max-w-[240px] px-3 py-2.5">
                {row.name === null ? (
                  <AbsentWord />
                ) : (
                  <span className="flex min-w-0 flex-col">
                    <span
                      className="truncate font-mono text-[12.5px] text-foreground/90"
                      title={row.name}
                    >
                      {row.name}
                    </span>
                    {row.path === null || row.path === "/" ? null : (
                      <span
                        className="truncate font-mono text-[11.5px] text-muted-foreground"
                        title={row.path}
                      >
                        {row.path}
                      </span>
                    )}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <FlagWord on={row.secure} />
              </td>
              <td className="px-3 py-2.5">
                <FlagWord on={row.httpOnly} />
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap text-[12.5px] text-muted-foreground">
                {row.sameSite === null ? (
                  <AbsentWord />
                ) : (
                  (SAME_SITE_LABEL[row.sameSite] ?? row.sameSite)
                )}
              </td>
              <td className="px-3 py-2.5 whitespace-nowrap">
                {row.lifespanDays === null ? (
                  <AbsentWord />
                ) : (
                  <span
                    className={cn(
                      "text-[12.5px] tabular-nums",
                      row.lifespanDays < 0
                        ? "font-medium text-destructive"
                        : "text-foreground/80",
                    )}
                  >
                    {formatLifespan(row.lifespanDays)}
                  </span>
                )}
              </td>
              <td className="px-3 py-2.5">
                <TimeCell utc={row.created} />
              </td>
              <td className="px-3 py-2.5">
                <StateWord state={row.finding.commitState} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function CookiesPage({
  config,
}: {
  readonly config: ArtifactConfig;
}) {
  const list = useCookies(config.route);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<string | null>(null);

  const profiles = useMemo(
    () => [...new Set(list.rows.map((row) => row.finding.profile))].sort(),
    [list.rows],
  );

  const summary = useMemo(() => summarize(list.rows), [list.rows]);

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    return list.rows.filter((row) => {
      if (profileFilter !== null && row.finding.profile !== profileFilter) {
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
  }, [list.rows, search, profileFilter]);

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
        <div className="flex flex-col gap-3" aria-label="Loading cookies">
          <Skeleton className="h-[104px] w-full" />
          <Skeleton className="h-[220px] w-full" />
          <Skeleton className="h-[320px] w-full" />
        </div>
      ) : list.rows.length === 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <EmptyRows message="No Cookies rows in this Case." />
        </section>
      ) : (
        <>
          <PostureStrip summary={summary} />

          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 lg:col-span-4">
              <SameSiteCard rows={list.rows} />
            </div>
            <div className="col-span-12 lg:col-span-4">
              <LifespanCard rows={list.rows} />
            </div>
            <div className="col-span-12 lg:col-span-4">
              <HostBoardCard rows={list.rows} />
            </div>
          </div>

          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">All loaded cookies</h2>
              <span className="text-[12px] text-muted-foreground tabular-nums">
                {list.rows.length}
              </span>
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
                    placeholder="Search host or name"
                    aria-label="Search loaded cookies"
                    className="h-8 w-[200px] rounded-md border border-input bg-background pl-8 pr-3 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>
            </header>

            {visible.length === 0 ? (
              <EmptyRows
                message={
                  filtered
                    ? "No loaded cookies match this filter."
                    : "No Cookies rows in this Case."
                }
              />
            ) : (
              <CookieTable rows={visible} onSelect={select} />
            )}

            <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
              <p
                className="text-[12.5px] text-muted-foreground tabular-nums"
                aria-live="polite"
              >
                {filtered
                  ? `${String(visible.length)} of ${String(list.rows.length)} loaded cookies shown`
                  : `${String(list.rows.length)} cookie${list.rows.length === 1 ? "" : "s"} shown`}
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
