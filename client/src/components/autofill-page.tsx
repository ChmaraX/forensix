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
 *    name Chrome recorded fully determines the class. Each class doubles as a
 *    filter for the table;
 *  - a reuse leaderboard, ranked by the browser's own `timesUsed` count — the
 *    values the person filled most often;
 *  - a creation-over-time area, one point per week, drawn only across weeks
 *    the evidence actually spans.
 *
 * Presentation rules kept: TYPE (the field type) is the first table column;
 * saved entries and entries recovered from WAL / journal sidecars are
 * separate lists (the Saved / Recovered switch), never sorted together;
 * `absent` and `(empty)` render as words, never a blank; state is a worded
 * dot, never colour alone. No control here can start or rerun ingest,
 * analysis, or export.
 */
import { ClipboardList, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  Panel,
  PanelDescription,
  PanelHeader,
  PanelTitle,
} from "@/components/panel";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { badgeColors, type BadgeColor } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/misc";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type { ArtifactConfig, Finding, PageOf } from "../types.js";
import {
  CHART_FOCUS_CLASS,
  chartAnimation,
  chartAxis,
  chartGrid,
  ChartEmpty,
  ChartTooltipCard,
  ChartTooltipValue,
  chartTooltipMotion,
  tooltipEntry,
  useChartTokens,
  usePrefersReducedMotion,
  type ChartTokens,
} from "./charts.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import {
  AbsentWord,
  fieldInteger,
  fieldText,
  fieldUtc,
  formatInstant,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField } from "./filters.js";
import { ErrorRows } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

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
 *
 * Each class carries one hue (an FF Badge colour), used on its dot and its
 * bar segment; the class name always sits beside it.
 */
interface Category {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly color: BadgeColor;
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
  color: "gray",
  matches: () => true,
};

const CATEGORIES: readonly Category[] = [
  {
    key: "identity",
    label: "Identity",
    hint: "Names and who the person is",
    color: "blue",
    matches: (name) => /\bname\b|company|first|last|middle/.test(name),
  },
  {
    key: "contact",
    label: "Contact",
    hint: "E-mail and phone",
    color: "green",
    matches: (name) => /email|e_mail|phone|tel\b|mobile|fax/.test(name),
  },
  {
    key: "address",
    label: "Address",
    hint: "Postal and location fields",
    color: "amber",
    matches: (name) =>
      /address|street|city|state|zip|postal|country|province|region/.test(name),
  },
  {
    key: "payment",
    label: "Payment",
    hint: "Card and wallet fields",
    color: "red",
    matches: (name) =>
      /card|credit|cvc|cvv|wallet|iban|account_number/.test(name),
  },
  {
    key: "searches",
    label: "Searches",
    hint: "Free text typed into search and query boxes",
    color: "violet",
    matches: (name) => /search|query|\bq\b|find|lookup|keyword/.test(name),
  },
  OTHER_CATEGORY,
];

/** The class of one Chrome field name, resolved once by the fixed rule above. */
function categoryOf(fieldName: string | null): Category {
  const name = (fieldName ?? "").toLowerCase();
  return (
    CATEGORIES.find((category) => category.matches(name)) ?? OTHER_CATEGORY
  );
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

/** A category's dot: its hue, always beside its name. */
function CategoryDot({
  category,
  className,
}: {
  readonly category: Category;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", className)}
      style={{ backgroundColor: badgeColors[category.color] }}
    />
  );
}

/**
 * The category breakdown: one stacked bar showing each class's share of the
 * whole set, then the classes themselves as a grid of choices — each names
 * its class, says what it covers, and gives the exact count. Picking a class
 * narrows the table below to it (a second pick clears), so the grid takes
 * FF's 2-D fluid hover. The bar is a proportion of counts the rows carry,
 * never a score or a projection.
 */
function CategoryBreakdown({
  categories,
  total,
  activeKey,
  onPick,
}: {
  readonly categories: Derived["categories"];
  readonly total: number;
  readonly activeKey: string | null;
  readonly onPick: (key: string) => void;
}) {
  const gridRef = useRef<HTMLUListElement>(null);
  const hover = useFluidHover(gridRef, {
    axis: "xy",
    gapClick: { maxDistance: 16 },
  });
  const shape = useShape();
  if (total === 0 || categories.length === 0) {
    return null;
  }
  return (
    <Panel>
      <PanelHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>Saved data by category</PanelTitle>
          <PanelDescription>
            Chrome's field types, grouped into what they describe. Pick one to
            narrow the table.
          </PanelDescription>
        </div>
      </PanelHeader>
      <div className="flex flex-col gap-3 px-4 pt-2 pb-1">
        <div
          className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full"
          role="img"
          aria-label={categories
            .map((entry) => `${entry.category.label} ${String(entry.count)}`)
            .join(", ")}
        >
          {categories.map((entry) => (
            <span
              key={entry.category.key}
              className="h-full first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${String((entry.count / total) * 100)}%`,
                backgroundColor: badgeColors[entry.category.color],
              }}
            />
          ))}
        </div>
      </div>
      <ul
        ref={gridRef}
        {...hover.handlers}
        className="relative grid grid-cols-1 gap-x-1 px-1 pb-1 sm:grid-cols-2 lg:grid-cols-3"
      >
        <FluidHoverHighlight hover={hover} className={shape.item} />
        {categories.map((entry, index) => (
          <CategoryChoice
            key={entry.category.key}
            index={index}
            registerItem={hover.registerItem}
            category={entry.category}
            count={entry.count}
            share={Math.round((entry.count / total) * 100)}
            active={activeKey === entry.category.key}
            onPick={onPick}
          />
        ))}
      </ul>
    </Panel>
  );
}

function CategoryChoice({
  index,
  registerItem,
  category,
  count,
  share,
  active,
  onPick,
}: {
  readonly index: number;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
  readonly category: Category;
  readonly count: number;
  readonly share: number;
  readonly active: boolean;
  readonly onPick: (key: string) => void;
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
          onPick(category.key);
        }}
        className={cn(
          "relative flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-left transition-colors duration-80",
          shape.item,
          active && "bg-active",
        )}
      >
        <CategoryDot category={category} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span
            className={cn(typeClass("body"), "inline-grid text-foreground")}
          >
            <span
              className="col-start-1 row-start-1 transition-[font-variation-settings] duration-80"
              style={{
                fontVariationSettings: active
                  ? fontWeights.semibold
                  : fontWeights.normal,
              }}
            >
              {category.label}
            </span>
            <span
              aria-hidden="true"
              className="invisible col-start-1 row-start-1"
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              {category.label}
            </span>
          </span>
          <span
            className={cn(
              typeClass("caption"),
              "truncate text-muted-foreground",
            )}
          >
            {category.hint}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span
            className={cn(typeClass("body"), "text-foreground tabular-nums")}
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {count.toLocaleString("en-US")}
          </span>
          <span
            className={cn(
              typeClass("caption"),
              "text-muted-foreground tabular-nums",
            )}
          >
            {share}%
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * The reuse leaderboard: the entries with the highest recorded `timesUsed`,
 * i.e. the values the person filled most often. Each row opens its full
 * record. A value with no recorded use count sits out of this list entirely
 * rather than being ranked at zero — the list is "most reused", and an
 * unfilled count is not a zero.
 */
const REUSE_LIMIT = 6;

function ReuseLeaderboard({
  reuse,
  onSelect,
}: {
  readonly reuse: Derived["reuse"];
  readonly onSelect: (row: Finding) => void;
}) {
  const ranked = reuse
    .filter((entry) => entry.timesUsed > 0)
    .slice(0, REUSE_LIMIT);
  const peak = ranked[0]?.timesUsed ?? 0;
  const listRef = useRef<HTMLOListElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();
  return (
    <Panel className="h-full">
      <PanelHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>Most-used entries</PanelTitle>
          <PanelDescription>
            By how many times Chrome recorded the value being filled.
          </PanelDescription>
        </div>
      </PanelHeader>
      {ranked.length === 0 ? (
        <p
          className={cn(
            typeClass("body"),
            "px-4 pt-2 pb-4 text-muted-foreground",
          )}
        >
          No entry carries a recorded fill count.
        </p>
      ) : (
        <ol
          ref={listRef}
          {...hover.handlers}
          className="relative flex flex-col px-1 pb-1"
        >
          <FluidHoverHighlight hover={hover} className={shape.item} />
          {ranked.map((entry, index) => (
            <ReuseRow
              key={`${entry.category.key}-${String(index)}`}
              index={index}
              registerItem={hover.registerItem}
              value={entry.value}
              category={entry.category}
              timesUsed={entry.timesUsed}
              peak={peak}
              onOpen={() => {
                onSelect(entry.row);
              }}
            />
          ))}
        </ol>
      )}
    </Panel>
  );
}

function ReuseRow({
  index,
  registerItem,
  value,
  category,
  timesUsed,
  peak,
  onOpen,
}: {
  readonly index: number;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
  readonly value: string | null;
  readonly category: Category;
  readonly timesUsed: number;
  readonly peak: number;
  readonly onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const shape = useShape();
  useRegisterFluidHoverItem(registerItem, index, ref);
  const share = peak === 0 ? 0 : (timesUsed / peak) * 100;
  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={onOpen}
        aria-label={`Open ${value ?? "(empty)"}, filled ${String(timesUsed)} times`}
        className={cn(
          "relative grid w-full cursor-pointer grid-cols-[1rem_minmax(0,1fr)_auto] items-center gap-3 px-3 py-2 text-left",
          shape.item,
        )}
      >
        <span
          className={cn(
            typeClass("caption"),
            "text-center text-muted-foreground tabular-nums",
          )}
        >
          {index + 1}
        </span>
        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="flex min-w-0 items-center gap-2">
            <CategoryDot category={category} className="size-1.5" />
            <span
              className={cn(
                typeClass("body"),
                "truncate",
                value === null ? "text-muted-foreground" : "text-foreground",
              )}
              title={value ?? undefined}
            >
              {value ?? "(empty)"}
            </span>
          </span>
          <span className="h-1 overflow-hidden rounded-full bg-active">
            <span
              className={cn(
                "block h-full rounded-full bg-foreground",
                index === 0 ? "opacity-90" : "opacity-45",
              )}
              style={{ width: `${String(share)}%` }}
            />
          </span>
        </span>
        <span className="flex shrink-0 items-baseline gap-1">
          <span
            className={cn(typeClass("body"), "text-foreground tabular-nums")}
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {timesUsed.toLocaleString("en-US")}
          </span>
          <span className={cn(typeClass("caption"), "text-muted-foreground")}>
            {timesUsed === 1 ? "fill" : "fills"}
          </span>
        </span>
      </button>
    </li>
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
    return <ChartEmpty>No dated entries to draw.</ChartEmpty>;
  }
  const rows = weeks.map((entry) => ({
    ...entry,
    label: formatWeek(entry.week),
  }));
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      className={CHART_FOCUS_CLASS}
    >
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fxAutofillFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={tokens["--primary"]}
              stopOpacity={0.24}
            />
            <stop
              offset="100%"
              stopColor={tokens["--primary"]}
              stopOpacity={0}
            />
          </linearGradient>
        </defs>
        <CartesianGrid {...chartGrid(tokens)} />
        <XAxis dataKey="label" minTickGap={40} {...chartAxis(tokens)} />
        <YAxis width={30} allowDecimals={false} {...chartAxis(tokens)} />
        <ChartTooltip
          {...chartTooltipMotion(reduced)}
          cursor={{ stroke: tokens["--border"], strokeWidth: 1 }}
          content={({ payload }) => {
            const datum = tooltipEntry(payload);
            if (datum === null) {
              return null;
            }
            const count = Number(datum["count"]);
            return (
              <ChartTooltipCard label={`Week of ${String(datum["label"])}`}>
                <ChartTooltipValue
                  value={count.toLocaleString("en-US")}
                  unit={count === 1 ? "entry saved" : "entries saved"}
                  color={tokens["--primary"]}
                />
              </ChartTooltipCard>
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke={tokens["--primary"]}
          strokeWidth={1.5}
          fill="url(#fxAutofillFill)"
          {...chartAnimation(reduced)}
          activeDot={{
            r: 3.5,
            fill: tokens["--primary"],
            stroke: tokens["--background"],
            strokeWidth: 2,
          }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** The class a row's field type falls in — the same fixed rule the breakdown
 *  uses, restated inline so the table reads without cross-referencing. */
function CategoryWord({ category }: { readonly category: Category }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <CategoryDot category={category} className="size-1.5" />
      {category.label}
    </span>
  );
}

type View = "saved" | "recovered";

const ALL_CATEGORIES = "__all__";

/**
 * Raw table — every loaded entry, with the fields an examiner reads first.
 * TYPE (the field type) is the first column, per the app's presentation
 * rule; the full untranslated Chrome name and every other wire field stay
 * reachable in the row detail sheet.
 */
function EntryListPanel({
  derived,
  complete,
  categoryFilter,
  onCategory,
  onSelect,
}: {
  readonly derived: Derived;
  readonly complete: boolean;
  readonly categoryFilter: string | null;
  readonly onCategory: (key: string | null) => void;
  readonly onSelect: (row: Finding) => void;
}) {
  const [view, setView] = useState<View>("saved");
  const [search, setSearch] = useState("");
  const size = useSize("compact");

  const saved = useMemo(
    () =>
      derived.reuse.filter((entry) => entry.row.commitState === "committed"),
    [derived.reuse],
  );
  const recovered = useMemo(
    () =>
      derived.reuse.filter((entry) => entry.row.commitState !== "committed"),
    [derived.reuse],
  );
  const base = view === "saved" ? saved : recovered;

  // The table reads from the same reuse set so a row's derived
  // type/category/value is computed once, not per cell.
  const tableRows = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-US");
    return base.filter((entry) => {
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
  }, [base, search, categoryFilter]);

  const filtered = tableRows.length !== base.length;
  const noun = view === "saved" ? "saved" : "recovered";

  return (
    <Panel className="overflow-clip">
      <PanelHeader>
        <div className="flex min-w-0 flex-col gap-0.5">
          <PanelTitle>All saved entries</PanelTitle>
          <PanelDescription>
            Saved entries and entries recovered from WAL or journal sidecars are
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
            <TabsList aria-label="Saved or recovered entries">
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
            {derived.categories.length > 1 ? (
              <FilterField label="Category" htmlFor="autofill-category">
                <Select
                  value={categoryFilter ?? ALL_CATEGORIES}
                  onValueChange={(next) => {
                    onCategory(next === ALL_CATEGORIES ? null : next);
                  }}
                >
                  <SelectTrigger id="autofill-category" />
                  <SelectContent>
                    <SelectItem index={0} value={ALL_CATEGORIES}>
                      All categories
                    </SelectItem>
                    {derived.categories.map((entry, index) => (
                      <SelectItem
                        key={entry.category.key}
                        index={index + 1}
                        value={entry.category.key}
                      >
                        {entry.category.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FilterField>
            ) : null}
            <FilterTextField
              label="Search loaded form entries"
              placeholder="Search value or type"
              icon={Search}
              value={search}
              onCommit={setSearch}
            />
          </div>
        </div>
      </SizeProvider>

      <div className="border-t border-border">
        {tableRows.length === 0 ? (
          <EmptyRows
            message={
              filtered
                ? `No ${noun} entries match this filter.`
                : view === "saved"
                  ? "No saved Form data rows are loaded."
                  : "No form entries were recovered from WAL or journal sidecars."
            }
          />
        ) : (
          <div className="scroll-fade-x overflow-x-auto px-1 pb-1">
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  {[
                    "Type",
                    "Value",
                    "Category",
                    "Fills",
                    "Last used",
                    "State",
                  ].map((label) => (
                    <TableHead key={label} className="whitespace-nowrap">
                      {label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {tableRows.map((entry, index) => {
                  const lastUsed = fieldUtc(entry.row.fields.dateLastUsed);
                  const lastUsedParts =
                    lastUsed === null ? null : formatInstant(lastUsed);
                  return (
                    <TableRow
                      key={index}
                      index={index}
                      tabIndex={0}
                      aria-label={`Open form entry ${entry.type ?? ""}`}
                      onClick={() => {
                        onSelect(entry.row);
                      }}
                      onKeyDown={(event) => {
                        activateOnKey(event, () => {
                          onSelect(entry.row);
                        });
                      }}
                      className={ROW_FOCUS_CLASS}
                    >
                      <TableCell className="max-w-[220px]">
                        {entry.type === null ? (
                          <AbsentWord />
                        ) : (
                          <span
                            className="block truncate text-foreground"
                            title={entry.type}
                          >
                            {entry.type}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[340px]">
                        {entry.value === null ? (
                          <span className="whitespace-nowrap">(empty)</span>
                        ) : (
                          <span
                            className="block truncate font-mono"
                            title={entry.value}
                          >
                            {entry.value}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <CategoryWord category={entry.category} />
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {fieldInteger(entry.row.fields.timesUsed) === null ? (
                          <AbsentWord />
                        ) : (
                          entry.timesUsed.toLocaleString("en-US")
                        )}
                      </TableCell>
                      <TableCell>
                        {lastUsed === null || lastUsedParts === null ? (
                          <AbsentWord />
                        ) : (
                          <span
                            className="whitespace-nowrap tabular-nums"
                            title={`${lastUsed} (UTC)`}
                          >
                            {lastUsedParts.date}
                            <span className="ml-2 text-muted-foreground">
                              {lastUsedParts.time}
                            </span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StateWord state={entry.row.commitState} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
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
            ? `${tableRows.length.toLocaleString("en-US")} of ${base.length.toLocaleString("en-US")} ${noun} entries shown`
            : `${base.length.toLocaleString("en-US")} ${noun} ${base.length === 1 ? "entry" : "entries"} shown`}
          {complete ? "" : " · more available"}
        </p>
      </div>
    </Panel>
  );
}

/** Placeholder at the size of the strip, the breakdown, and the chart row. */
function AutofillSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="h-[112px] w-full rounded-xl" />
      <Skeleton className="h-[200px] w-full rounded-xl" />
      <div className="grid grid-cols-12 gap-4">
        <Skeleton className="col-span-12 h-[320px] rounded-xl lg:col-span-7" />
        <Skeleton className="col-span-12 h-[320px] rounded-xl lg:col-span-5" />
      </div>
    </div>
  );
}

export function AutofillPage({ config }: { readonly config: ArtifactConfig }) {
  const list = useAutofill(config.route);
  const derived = useDerived(list.rows);
  const tokens = useChartTokens();
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const pickCategory = useCallback((key: string) => {
    setCategoryFilter((current) => (current === key ? null : key));
  }, []);

  const sensitiveShare =
    derived.total === 0
      ? 0
      : Math.round((derived.sensitive / derived.total) * 100);

  return (
    <div className="flex flex-col gap-4">
      {list.error !== null ? (
        <ErrorRows
          message={list.error}
          onRetry={list.retry}
          className="px-0 py-0"
        />
      ) : !list.loading && derived.total === 0 ? (
        <Panel>
          <EmptyRows
            icon={ClipboardList}
            title="No form data"
            message="No Form data rows in this Case."
          />
        </Panel>
      ) : (
        <div className="reveal-swap">
          <AutofillSkeleton />
          {list.loading ? null : (
            <div className="flex flex-col gap-4">
              {/* Summary strip — four plain readings of the loaded set.
                  "Sensitive" is Identity + Contact + Address + Payment:
                  entries that carry directly identifying or financial data,
                  as opposed to search text. Every figure is a count the rows
                  already carry. */}
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
                  detail={
                    derived.distinctTypes === 1
                      ? "distinct type"
                      : "distinct types"
                  }
                />
                <MetricBandItem
                  label="Sensitive"
                  value={`${String(sensitiveShare)}%`}
                  detail={`${derived.sensitive.toLocaleString("en-US")} identity, contact, address or payment`}
                  progress={{
                    value: derived.sensitive,
                    max: derived.total,
                    tone: "warning",
                    label: `${String(sensitiveShare)}% of saved entries`,
                  }}
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
                activeKey={categoryFilter}
                onPick={pickCategory}
              />

              <div className="grid grid-cols-12 gap-4">
                <Panel className="col-span-12 lg:col-span-7">
                  <PanelHeader>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <PanelTitle>First saved over time</PanelTitle>
                      <PanelDescription>
                        When each entry was first remembered, per week.
                      </PanelDescription>
                    </div>
                  </PanelHeader>
                  <div className="relative min-h-[240px] flex-1">
                    <div className="absolute inset-0 pt-2 pr-4 pb-3 pl-2">
                      <CreationArea weeks={derived.weeks} tokens={tokens} />
                    </div>
                  </div>
                </Panel>

                <div className="col-span-12 lg:col-span-5">
                  <ReuseLeaderboard reuse={derived.reuse} onSelect={select} />
                </div>
              </div>

              <EntryListPanel
                derived={derived}
                complete={list.complete}
                categoryFilter={categoryFilter}
                onCategory={setCategoryFilter}
                onSelect={select}
              />
            </div>
          )}
        </div>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={
            readableFieldType(fieldText(selected.row.fields.fieldName)) ??
            "Form entry"
          }
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
