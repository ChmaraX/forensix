/**
 * The Form data page.
 *
 * Chrome's autofill store is the one evidence set that holds what the person
 * *typed* — names, e-mails, addresses, payment names, and free-text search
 * queries they let the browser remember. So this page is built around the two
 * questions an examiner asks of it first: what kinds of personal data does
 * this browser hold, and which entries did the person actually reuse.
 *
 * Three derived reads sit above the raw table, each computed only from fields
 * the rows already carry — never a new query, never an invented figure:
 *
 *  - a category breakdown that groups Chrome's raw field names (EMAIL_ADDRESS,
 *    ADDRESS_HOME_ZIP, search-query, …) into the plain-language classes an
 *    examiner reasons in (Identity, Contact, Address, Payment, Searches,
 *    Other). The mapping is a fixed rule stated below, not a guess: the field
 *    name Chrome recorded fully determines the class;
 *  - a reuse leaderboard, ranked by the browser's own `timesUsed` count — the
 *    values the person filled most often;
 *  - a creation-over-time area, one point per week, drawn only across weeks
 *    the evidence actually spans.
 *
 * Presentation rules kept: the Completeness Statement ("Evidence coverage")
 * renders before any row; TYPE (the field type) is the first table column;
 * `absent` renders as the word, never a blank; state is a worded dot, never
 * color alone. No control here can start or rerun ingest, analysis, or export.
 */
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type {
  ArtifactConfig,
  Finding,
  PageOf,
} from "../types.js";
import {
  useChartTokens,
  usePrefersReducedMotion,
  type ChartTokens,
} from "./charts.js";
import { EmptyRows } from "./data-table.js";
import {
  AbsentWord,
  fieldInteger,
  fieldText,
  fieldUtc,
  formatInstant,
  StateWord,
} from "./finding-fields.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { Button } from "./ui/button.js";
import { Skeleton } from "./ui/misc.js";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/** One read of the whole Form data set across every Commit State, paginated
 *  by the route until the cursor runs out or the page cap is hit. The derived
 *  reads above the table are only honest if they cover the whole set, so this
 *  reads every page rather than the first screen. */
const AUTOFILL_PAGE_CAP = 60;

function useAutofill(route: string) {
  const [rows, setRows] = useState<readonly Finding[]>([]);
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRows([]);
    setComplete(false);

    const collected: Finding[] = [];
    let after: string | null = null;

    const step = async (): Promise<void> => {
      for (let page = 0; page < AUTOFILL_PAGE_CAP; page += 1) {
        const parameters: (readonly [string, string])[] = [
          ["sort", "last-used-time"],
          ["direction", "desc"],
          ["limit", "100"],
        ];
        if (after !== null) {
          parameters.push(["after", after]);
        }
        const result = await callApi<PageOf<Finding>>(route, parameters);
        collected.push(...result.items);
        after = result.nextCursor;
        if (after === null) {
          if (!cancelled) {
            setComplete(true);
          }
          return;
        }
      }
    };

    step()
      .then(() => {
        if (!cancelled) {
          setRows(collected);
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

  return { rows, complete, loading, error, retry };
}

/**
 * The plain-language classes an examiner reasons in, in reading order, each
 * with the fixed rule that assigns a Chrome field name to it. The rule is
 * pattern-on-name only — the field name Chrome recorded fully decides the
 * class, so the grouping is a restatement of the evidence, not a guess about
 * the value. `matches` is tried in order; the first hit wins, so the broad
 * "Searches" and "Other" buckets sit last.
 *
 * Chrome's own autofill field names are SCREAMING_SNAKE_CASE (NAME_FULL,
 * ADDRESS_HOME_ZIP, CREDIT_CARD_NUMBER); free-text form fields the person
 * typed into keep their raw HTML `name`/`id` (search-query, q, email). Both
 * are matched case-insensitively.
 */
interface Category {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly dot: string;
  readonly fill: string;
  readonly matches: (name: string) => boolean;
}

/** The `Other` bucket, and the fixed rule's guaranteed fallback: its `matches`
 *  returns true for everything, so it sits last in `CATEGORIES` and is also
 *  returned directly when no earlier class hits — so a field name always
 *  resolves to a defined class, with no index-into-array assumption. */
const OTHER_CATEGORY: Category = {
  key: "other",
  label: "Other",
  hint: "Everything Chrome did not label as the above",
  dot: "bg-muted-foreground/60",
  fill: "var(--muted-foreground)",
  matches: () => true,
};

const CATEGORIES: readonly Category[] = [
  {
    key: "identity",
    label: "Identity",
    hint: "Names and who the person is",
    dot: "bg-primary",
    fill: "var(--primary)",
    matches: (name) => /\bname\b|company|first|last|middle/.test(name),
  },
  {
    key: "contact",
    label: "Contact",
    hint: "E-mail and phone",
    dot: "bg-success",
    fill: "var(--success)",
    matches: (name) => /email|e_mail|phone|tel\b|mobile|fax/.test(name),
  },
  {
    key: "address",
    label: "Address",
    hint: "Postal and location fields",
    dot: "bg-warning",
    fill: "var(--warning)",
    matches: (name) =>
      /address|street|city|state|zip|postal|country|province|region/.test(name),
  },
  {
    key: "payment",
    label: "Payment",
    hint: "Card and wallet fields",
    dot: "bg-destructive",
    fill: "var(--destructive)",
    matches: (name) => /card|credit|cvc|cvv|wallet|iban|account_number/.test(name),
  },
  {
    key: "searches",
    label: "Searches",
    hint: "Free text typed into search and query boxes",
    dot: "bg-violet",
    fill: "var(--violet)",
    matches: (name) => /search|query|\bq\b|find|lookup|keyword/.test(name),
  },
  OTHER_CATEGORY,
];

/** The class of one Chrome field name, resolved once by the fixed rule above. */
function categoryOf(fieldName: string | null): Category {
  const name = (fieldName ?? "").toLowerCase();
  return CATEGORIES.find((category) => category.matches(name)) ?? OTHER_CATEGORY;
}

/**
 * A field type read back for display: Chrome's SCREAMING_SNAKE_CASE names are
 * turned into "Email address", "Address home zip" so the table scans as
 * language, while the exact recorded name stays reachable byte-for-byte in the
 * row detail sheet. A raw HTML field name (search-query) is left as-is — it is
 * already the string the page used, not a Chrome label to soften.
 */
function readableFieldType(fieldName: string | null): string | null {
  if (fieldName === null || fieldName === "") {
    return null;
  }
  if (!/^[A-Z0-9_]+$/.test(fieldName)) {
    return fieldName;
  }
  const words = fieldName.toLowerCase().split("_").filter(Boolean);
  if (words.length === 0) {
    return fieldName;
  }
  return words
    .map((word, index) =>
      index === 0 ? word.charAt(0).toUpperCase() + word.slice(1) : word,
    )
    .join(" ");
}

/** The ISO Monday of the UTC week a timestamp falls in, as a `YYYY-MM-DD`
 *  key — the bucketing the creation-over-time area groups on. */
function weekKey(utc: string): string | null {
  const parsed = new Date(utc);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  const day = parsed.getUTCDay();
  const mondayOffset = (day + 6) % 7;
  const monday = new Date(parsed);
  monday.setUTCDate(parsed.getUTCDate() - mondayOffset);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

function formatWeek(key: string): string {
  const parsed = new Date(`${key}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return key;
  }
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

interface Derived {
  readonly total: number;
  readonly distinctTypes: number;
  readonly sensitive: number;
  readonly categories: readonly {
    readonly category: Category;
    readonly count: number;
  }[];
  readonly reuse: readonly {
    readonly row: Finding;
    readonly value: string | null;
    readonly type: string | null;
    readonly category: Category;
    readonly timesUsed: number;
  }[];
  readonly weeks: readonly { readonly week: string; readonly count: number }[];
  readonly topReused: {
    readonly value: string | null;
    readonly timesUsed: number;
  } | null;
}

/** Every read the page shows above the table, computed once from the loaded
 *  set. Identity + Contact + Address + Payment is the "sensitive" tally: the
 *  entries that carry directly identifying or financial data, as opposed to
 *  search text. */
function useDerived(rows: readonly Finding[]): Derived {
  return useMemo(() => {
    const counts = new Map<string, number>();
    const distinct = new Set<string>();
    let sensitive = 0;

    const reuse = rows
      .map((row) => {
        const type = fieldText(row.fields.fieldName);
        const category = categoryOf(type);
        counts.set(category.key, (counts.get(category.key) ?? 0) + 1);
        if (type !== null) {
          distinct.add(type);
        }
        if (
          category.key === "identity" ||
          category.key === "contact" ||
          category.key === "address" ||
          category.key === "payment"
        ) {
          sensitive += 1;
        }
        return {
          row,
          value: fieldText(row.fields.fieldValue),
          type: readableFieldType(type),
          category,
          timesUsed: fieldInteger(row.fields.timesUsed) ?? 0,
        };
      })
      .sort((left, right) => right.timesUsed - left.timesUsed);

    const weekCounts = new Map<string, number>();
    for (const row of rows) {
      const created = fieldUtc(row.fields.dateCreated);
      if (created === null) {
        continue;
      }
      const key = weekKey(created);
      if (key !== null) {
        weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
      }
    }
    const weeks = [...weekCounts.entries()]
      .map(([week, count]) => ({ week, count }))
      .sort((left, right) => left.week.localeCompare(right.week));

    const categories = CATEGORIES.map((category) => ({
      category,
      count: counts.get(category.key) ?? 0,
    })).filter((entry) => entry.count > 0);

    const topReused = reuse[0] ?? null;

    return {
      total: rows.length,
      distinctTypes: distinct.size,
      sensitive,
      categories,
      reuse,
      weeks,
      topReused:
        topReused === undefined || topReused === null
          ? null
          : { value: topReused.value, timesUsed: topReused.timesUsed },
    };
  }, [rows]);
}


/**
 * The category breakdown: one stacked bar showing each class's share of the
 * whole set, then a legend that doubles as the exact counts. This is the
 * page's headline read — "what kinds of personal data does this browser hold"
 * — so it ranks first. The bar is a proportion of counts the rows carry, never a
 * score or a projection.
 */
function CategoryBreakdown({
  categories,
  total,
}: {
  readonly categories: Derived["categories"];
  readonly total: number;
}) {
  if (total === 0 || categories.length === 0) {
    return null;
  }
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">Saved data by category</h2>
        <p className="text-[12px] text-muted-foreground">
          Chrome's field types, grouped into what they describe.
        </p>
      </header>
      <div className="flex flex-col gap-4 px-4 py-4">
        <div
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role="img"
          aria-label="Share of saved form entries by category"
        >
          {categories.map((entry) => (
            <span
              key={entry.category.key}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${String((entry.count / total) * 100)}%`,
                backgroundColor: entry.category.fill,
              }}
              title={`${entry.category.label}: ${String(entry.count)}`}
            />
          ))}
        </div>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((entry) => (
            <li
              key={entry.category.key}
              className="flex items-center gap-2.5"
            >
              <span
                aria-hidden="true"
                className={cn("size-2.5 shrink-0 rounded-full", entry.category.dot)}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[13px] font-medium">
                  {entry.category.label}
                </span>
                <span className="truncate text-[11.5px] text-muted-foreground">
                  {entry.category.hint}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[13px] font-semibold tabular-nums">
                {entry.count}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * The reuse leaderboard: the entries with the highest recorded `timesUsed`,
 * i.e. the values the person filled most often. Each row is clickable through
 * to its full record. A value with no recorded use count sits out of this
 * list entirely rather than being ranked at zero — the list is "most reused",
 * and an unfilled count is not a zero.
 */
const REUSE_LIMIT = 6;

function ReuseLeaderboard({
  reuse,
  onSelect,
}: {
  readonly reuse: Derived["reuse"];
  readonly onSelect: (row: Finding) => void;
}) {
  const ranked = reuse.filter((entry) => entry.timesUsed > 0).slice(0, REUSE_LIMIT);
  const peak = ranked[0]?.timesUsed ?? 0;
  if (ranked.length === 0) {
    return null;
  }
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">Most-used entries</h2>
        <p className="text-[12px] text-muted-foreground">
          By how many times Chrome recorded the value being filled.
        </p>
      </header>
      <ol className="flex flex-col p-2">
        {ranked.map((entry, index) => {
          const share = peak === 0 ? 0 : Math.round((entry.timesUsed / peak) * 100);
          return (
            <li key={`${entry.category.key}-${String(index)}`}>
              <button
                type="button"
                onClick={() => {
                  onSelect(entry.row);
                }}
                className="grid w-full grid-cols-[1.25rem_1fr_auto] items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors duration-100 hover:bg-accent/40"
              >
                <span
                  className={cn(
                    "text-center text-[13px] font-semibold tabular-nums",
                    index === 0 ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {index + 1}
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span
                      aria-hidden="true"
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        entry.category.dot,
                      )}
                    />
                    <span
                      className="truncate text-[13px] font-medium"
                      title={entry.value ?? undefined}
                    >
                      {entry.value ?? "(empty)"}
                    </span>
                  </span>
                  <span className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <span
                      className={cn(
                        "block h-full rounded-full",
                        index === 0 ? "bg-primary" : "bg-primary/45",
                      )}
                      style={{ width: `${String(share)}%` }}
                    />
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end">
                  <span className="font-mono text-[13px] font-semibold tabular-nums">
                    {entry.timesUsed.toLocaleString("en-US")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {entry.timesUsed === 1 ? "fill" : "fills"}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * Entries saved per week, drawn only across the weeks the evidence spans. The
 * `dateCreated` a Chrome autofill row carries is when the value was first
 * saved, so this reads as "when did this browser start remembering things" —
 * a first-seen shape, not a usage trend.
 */
function CreationArea({
  weeks,
  tokens,
}: {
  readonly weeks: Derived["weeks"];
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  if (weeks.length === 0) {
    return (
      <div className="flex h-full min-h-[120px] items-center justify-center text-[13px] text-muted-foreground">
        No dated entries to draw.
      </div>
    );
  }
  const rows = weeks.map((entry) => ({
    ...entry,
    label: formatWeek(entry.week),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fxAutofillFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={tokens["--primary"]} stopOpacity={0.3} />
            <stop offset="100%" stopColor={tokens["--primary"]} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          vertical={false}
          stroke={tokens["--border"]}
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          minTickGap={40}
          tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
        />
        <YAxis
          width={30}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
        />
        <Tooltip
          cursor={{ stroke: tokens["--border"], strokeWidth: 1 }}
          content={({ payload }) => {
            if (!Array.isArray(payload) || payload.length === 0) {
              return null;
            }
            const datum = (payload[0] as { payload?: Record<string, unknown> })
              .payload;
            if (datum === undefined) {
              return null;
            }
            const count = Number(datum["count"]);
            return (
              <div
                className="rounded-md border px-3 py-2 text-[12px] shadow-md"
                style={{
                  backgroundColor: tokens["--card"],
                  borderColor: tokens["--border"],
                  color: tokens["--foreground"],
                }}
              >
                <p className="font-medium">Week of {String(datum["label"])}</p>
                <p
                  className="tabular-nums"
                  style={{ color: tokens["--muted-foreground"] }}
                >
                  {count.toLocaleString("en-US")}{" "}
                  {count === 1 ? "entry saved" : "entries saved"}
                </p>
              </div>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke={tokens["--primary"]}
          strokeWidth={2}
          fill="url(#fxAutofillFill)"
          isAnimationActive={!reduced}
          animationDuration={650}
          activeDot={{
            r: 4,
            fill: tokens["--primary"],
            stroke: tokens["--card"],
            strokeWidth: 2,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** A quiet chip stating which category a row's field type falls in — the same
 *  fixed rule the breakdown uses, restated inline so the table reads without
 *  cross-referencing the bar above. */
function CategoryChip({ category }: { readonly category: Category }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[11.5px] whitespace-nowrap text-muted-foreground">
      <span
        aria-hidden="true"
        className={cn("size-1.5 rounded-full", category.dot)}
      />
      {category.label}
    </span>
  );
}

export function AutofillPage({
  config,
}: {
  readonly config: ArtifactConfig;
}) {
  const list = useAutofill(config.route);
  const derived = useDerived(list.rows);
  const tokens = useChartTokens();
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  // The table reads from the same reuse set (already last-used-first ordered)
  // so a row's derived type/category/value is computed once, not per cell.
  const tableRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    return derived.reuse.filter((entry) => {
      if (categoryFilter !== null && entry.category.key !== categoryFilter) {
        return false;
      }
      if (query === "") {
        return true;
      }
      const haystack = [entry.value ?? "", entry.type ?? ""]
        .join("\n")
        .toLocaleLowerCase("en-US");
      return haystack.includes(query);
    });
  }, [derived.reuse, search, categoryFilter]);

  const filtered = tableRows.length !== derived.reuse.length;

  const sensitiveShare =
    derived.total === 0
      ? 0
      : Math.round((derived.sensitive / derived.total) * 100);

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
            <Skeleton className="h-[92px] rounded-lg" />
            <Skeleton className="h-[92px] rounded-lg" />
            <Skeleton className="h-[92px] rounded-lg" />
            <Skeleton className="h-[92px] rounded-lg" />
          </div>
          <Skeleton className="h-[160px] w-full rounded-lg" />
          <Skeleton className="h-[300px] w-full rounded-lg" />
        </div>
      ) : derived.total === 0 ? (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <EmptyRows message="No Form data rows in this Case." />
        </section>
      ) : (
        <>
          {/* Summary strip — four plain readings of the loaded set. "Sensitive"
              is Identity + Contact + Address + Payment: entries that carry
              directly identifying or financial data, as opposed to search
              text. Every figure is a count the rows already carry. */}
          <MetricBand className="grid-cols-2 sm:grid-cols-4">
            <MetricBandItem
              label="Saved entries"
              value={derived.total.toLocaleString("en-US")}
              detail={
                list.complete ? "across all profiles" : "first pages loaded"
              }
            />
            <MetricBandItem
              label="Field types"
              value={derived.distinctTypes.toLocaleString("en-US")}
              detail={derived.distinctTypes === 1 ? "distinct type" : "distinct types"}
            />
            <MetricBandItem
              label="Sensitive"
              value={`${String(sensitiveShare)}%`}
              detail={`${derived.sensitive.toLocaleString("en-US")} identity, contact, address or payment`}
              progress={{ value: derived.sensitive, max: derived.total, tone: "warning", label: `${String(sensitiveShare)}% of saved entries` }}
            />
            <MetricBandItem
              label="Most reused"
              value={
                derived.topReused === null
                  ? "—"
                  : derived.topReused.timesUsed.toLocaleString("en-US")
              }
              detail={
                derived.topReused === null
                  ? "no recorded fills"
                  : (derived.topReused.value ?? "(empty)")
              }
            />
          </MetricBand>

          <CategoryBreakdown
            categories={derived.categories}
            total={derived.total}
          />

          <div className="grid grid-cols-12 gap-4">
            <section className="col-span-12 overflow-hidden rounded-lg border border-border bg-card lg:col-span-7">
              <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-border px-4 py-2.5">
                <h2 className="text-[13px] font-semibold">First saved over time</h2>
                <p className="text-[12px] text-muted-foreground">
                  When each entry was first remembered, per week.
                </p>
              </header>
              <div className="relative min-h-[220px] p-1">
                <div className="absolute inset-0 pt-3 pr-4 pb-3 pl-2">
                  <CreationArea weeks={derived.weeks} tokens={tokens} />
                </div>
              </div>
            </section>

            <div className="col-span-12 lg:col-span-5">
              <ReuseLeaderboard reuse={derived.reuse} onSelect={select} />
            </div>
          </div>

          {/* Raw table — every loaded entry, with the fields an examiner reads
              first. TYPE (the field type) is the first column, per the app's
              presentation rule; the full untranslated Chrome name and every
              other wire field stay reachable in the row detail sheet. */}
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
              <h2 className="text-[13px] font-semibold">All saved entries</h2>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                {derived.categories.length > 1
                  ? derived.categories.map((entry) => (
                      <button
                        key={entry.category.key}
                        type="button"
                        aria-pressed={categoryFilter === entry.category.key}
                        onClick={() => {
                          setCategoryFilter(
                            categoryFilter === entry.category.key
                              ? null
                              : entry.category.key,
                          );
                        }}
                        className={cn(
                          "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150",
                          categoryFilter === entry.category.key
                            ? "border-accent-border bg-accent text-accent-foreground"
                            : "border-border bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn("size-1.5 rounded-full", entry.category.dot)}
                        />
                        {entry.category.label}
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
                    placeholder="Search value or type"
                    aria-label="Search loaded form entries"
                    className="h-8 w-[200px] rounded-md border border-input bg-background pr-3 pl-8 text-[12.5px] outline-none focus:ring-2 focus:ring-ring"
                  />
                </label>
              </div>
            </header>

            {tableRows.length === 0 ? (
              <EmptyRows message="No loaded rows match this filter." />
            ) : (
              <div className="fx-scroll-x">
                <table className="w-full text-left text-[13px]">
                  <thead>
                    <tr>
                      {["Type", "Value", "Category", "Fills", "Last used", "State"].map(
                        (label) => (
                          <th
                            key={label}
                            className="sticky top-0 z-10 border-b border-border bg-muted/80 px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase backdrop-blur"
                          >
                            {label}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((entry, index) => {
                      const lastUsed = fieldUtc(entry.row.fields.dateLastUsed);
                      const lastUsedParts =
                        lastUsed === null ? null : formatInstant(lastUsed);
                      return (
                        <tr
                          key={index}
                          tabIndex={0}
                          aria-label="Open form entry detail"
                          onClick={() => {
                            select(entry.row);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              select(entry.row);
                            }
                          }}
                          className="cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-accent/40"
                        >
                          <td className="max-w-[200px] px-3 py-2.5">
                            <span
                              className="block truncate font-medium text-foreground/90"
                              title={entry.type ?? undefined}
                            >
                              {entry.type ?? <AbsentWord />}
                            </span>
                          </td>
                          <td className="max-w-[340px] px-3 py-2.5">
                            {entry.value === null ? (
                              <span className="text-[12.5px] text-muted-foreground italic">
                                (empty)
                              </span>
                            ) : (
                              <span
                                className="block truncate font-mono text-[12.5px] text-foreground/85"
                                title={entry.value}
                              >
                                {entry.value}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <CategoryChip category={entry.category} />
                          </td>
                          <td className="px-3 py-2.5 font-mono text-[12.5px] tabular-nums">
                            {fieldInteger(entry.row.fields.timesUsed) === null ? (
                              <AbsentWord />
                            ) : (
                              entry.timesUsed.toLocaleString("en-US")
                            )}
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">
                            {lastUsedParts === null ? (
                              <AbsentWord />
                            ) : (
                              <span className="flex flex-col leading-tight">
                                <span className="text-[12.5px] text-foreground/85">
                                  {lastUsedParts.date}
                                </span>
                                <span className="font-mono text-[11px] text-muted-foreground">
                                  {lastUsedParts.time}
                                </span>
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-2.5">
                            <StateWord state={entry.row.commitState} />
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
                  ? `${String(tableRows.length)} of ${String(derived.reuse.length)} loaded rows shown`
                  : `${String(derived.total)} row${derived.total === 1 ? "" : "s"} shown`}
                {list.complete ? "" : " · more available"}
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
