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
 * the saved rows already carry — never a new query, never an invented figure:
 *
 *  - a category breakdown that groups Chrome's raw field names (EMAIL_ADDRESS,
 *    ADDRESS_HOME_ZIP, search-query, …) into the plain-language classes an
 *    examiner reasons in (Payment, Identity, Contact, Address, Searches,
 *    Other). The mapping is a fixed rule stated below, not a guess: the field
 *    name Chrome recorded fully determines the class. Each class doubles as a
 *    filter for the lists;
 *  - a reuse leaderboard, ranked by the browser's own `timesUsed` count — the
 *    values the person filled most often;
 *  - a creation-over-time area, one point per week, drawn only across weeks
 *    the evidence actually spans.
 *
 * Payment-category values (card, CVC, IBAN, wallet, account fields) are
 * secrets: they read "value hidden" everywhere — table, leaderboard, tile,
 * accessible names — until the page's "Show values" switch is on, are left
 * out of the search text while hidden, and stay hidden in the row sheet
 * behind its own Reveal control.
 *
 * Presentation rules kept: TYPE (the field type) is the first table column;
 * saved entries and entries recovered from WAL / journal sidecars are
 * separate server reads and separate lists (the Saved / Recovered switch),
 * never sorted together, and every figure counts saved entries only;
 * (empty) / absent / unavailable render as their own words. No control here
 * can start or rerun ingest, analysis, or export.
 */
import { ClipboardList, Search } from "lucide-react";
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Panel } from "@/components/panel";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig, FieldState, Finding } from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
import { ChartSection } from "./chart-section.js";
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
  CARD_TITLE_CLEAR,
  CommitStateSplit,
  Count,
  formatDayTick,
  plural,
  SectionPanel,
  ShareBar,
  TimeCell,
  type CommitView,
} from "./page-kit.js";
import {
  FieldCell,
  fieldInteger,
  fieldText,
  fieldUtc,
  StateWord,
} from "./finding-fields.js";
import { FilterField, FilterTextField } from "./filters.js";
import {
  categoryOf,
  FORM_DATA_CATEGORIES,
  isPaymentField,
  PAYMENT_KEY,
  PAYMENT_SECRET_FIELDS,
  type FormDataCategory,
} from "./form-data.js";
import { ListBlock } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { HiddenValue, RowSheet, type SelectedRow } from "./row-sheet.js";

/* ------------------------------ data reading ------------------------------ */

const AUTOFILL_PARAMETERS: QueryParameters = [
  ["sort", "last-used-time"],
  ["direction", "desc"],
  ["limit", "100"],
];

/** Rows read per list before the page stops following the cursor. The
 *  derived reads above the table are only honest if they cover the whole
 *  set, so every page is read rather than the first screen. */
const AUTOFILL_ROW_CAP = 6000;

/**
 * A field type read back for display: Chrome's SCREAMING_SNAKE_CASE names are
 * turned into "Email address", "Address home zip" so the table scans as
 * language, while the exact recorded name stays reachable byte-for-byte in the
 * row detail sheet. A raw HTML field name (search-query) is left as-is.
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

/** A field as one word for an accessible name or a caption: the value, or
 *  "(empty)" / "absent" / "unavailable" — never a blank. */
function fieldWord(field: FieldState | undefined): string {
  if (field === undefined || field.state === "absent") {
    return "absent";
  }
  if (field.state === "unavailable") {
    return "unavailable";
  }
  if (field.value === "" || field.value === null) {
    return "(empty)";
  }
  return typeof field.value === "string" ? field.value : String(field.value);
}

/** True for a Payment entry that carries a recorded, non-empty value — the
 *  secret the page withholds until "Show values" is on. */
function holdsSecret(entry: Entry): boolean {
  return entry.category.key === PAYMENT_KEY && entry.value !== null;
}

/** The ISO Monday of the UTC week a timestamp falls in, as `YYYY-MM-DD`. */
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

/* ------------------------------ derived reads ----------------------------- */

interface Entry {
  readonly row: Finding;
  /** The recorded non-empty value, or null (see `row.fields.fieldValue`). */
  readonly value: string | null;
  readonly type: string | null;
  readonly category: FormDataCategory;
  readonly timesUsed: number;
}

function toEntry(row: Finding): Entry {
  const type = fieldText(row.fields.fieldName);
  return {
    row,
    value: fieldText(row.fields.fieldValue),
    type: readableFieldType(type),
    category: categoryOf(type),
    timesUsed: fieldInteger(row.fields.timesUsed) ?? 0,
  };
}

interface Derived {
  readonly total: number;
  readonly distinctTypes: number;
  readonly sensitive: number;
  readonly hasPayment: boolean;
  readonly categories: readonly {
    readonly category: FormDataCategory;
    readonly count: number;
  }[];
  /** Saved entries by recorded fill count, most first. */
  readonly ranked: readonly Entry[];
  readonly weeks: readonly { readonly week: string; readonly count: number }[];
}

/** Every read the page shows above the table, from the saved entries.
 *  Identity + Contact + Address + Payment is the "sensitive" tally: the
 *  entries that carry directly identifying or financial data, as opposed to
 *  search text. */
function derive(entries: readonly Entry[]): Derived {
  const counts = new Map<string, number>();
  const distinct = new Set<string>();
  let sensitive = 0;
  for (const entry of entries) {
    const key = entry.category.key;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    const name = fieldText(entry.row.fields.fieldName);
    if (name !== null) {
      distinct.add(name);
    }
    if (key !== "searches" && key !== "other") {
      sensitive += 1;
    }
  }

  const weekCounts = new Map<string, number>();
  for (const entry of entries) {
    const created = fieldUtc(entry.row.fields.dateCreated);
    const key = created === null ? null : weekKey(created);
    if (key !== null) {
      weekCounts.set(key, (weekCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    total: entries.length,
    distinctTypes: distinct.size,
    sensitive,
    hasPayment: (counts.get(PAYMENT_KEY) ?? 0) > 0,
    categories: FORM_DATA_CATEGORIES.map((category) => ({
      category,
      count: counts.get(category.key) ?? 0,
    })).filter((entry) => entry.count > 0),
    ranked: [...entries]
      .filter((entry) => entry.timesUsed > 0)
      .sort((left, right) => right.timesUsed - left.timesUsed),
    weeks: [...weekCounts.entries()]
      .map(([week, count]) => ({ week, count }))
      .sort((left, right) => left.week.localeCompare(right.week)),
  };
}

/* --------------------------------- widgets -------------------------------- */

const WIDE = "(min-width: 1024px)";
const MEDIUM = "(min-width: 640px)";

function subscribeColumns(onChange: () => void): () => void {
  const wide = globalThis.matchMedia(WIDE);
  const medium = globalThis.matchMedia(MEDIUM);
  wide.addEventListener("change", onChange);
  medium.addEventListener("change", onChange);
  return () => {
    wide.removeEventListener("change", onChange);
    medium.removeEventListener("change", onChange);
  };
}

function readColumns(): number {
  if (globalThis.matchMedia(WIDE).matches) {
    return 3;
  }
  return globalThis.matchMedia(MEDIUM).matches ? 2 : 1;
}

/**
 * The category breakdown: each class as an FF Card — its name, what it
 * covers, its count and share of the saved entries. Picking a class narrows
 * both lists to it (a second pick clears). Counts the rows carry, never a
 * score or a projection; the class name is the label, no hue stands in.
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
  const columns = useSyncExternalStore(subscribeColumns, readColumns);
  if (total === 0 || categories.length === 0) {
    return null;
  }
  return (
    <SectionPanel
      id="autofill-categories"
      title="Saved data by category"
      description="Chrome's field types in the saved entries, grouped into what they describe. Pick one to narrow the lists."
    >
      <div className="p-1">
        <SizeProvider size="compact">
          <CardGroup orientation="inline" columns={columns}>
            {categories.map((entry) => (
              <Card
                key={entry.category.key}
                label={`Narrow the lists to ${entry.category.label}`}
                selected={activeKey === entry.category.key}
                onClick={() => {
                  onPick(entry.category.key);
                }}
              >
                <CardHeader className="min-w-0">
                  <CardTitle className={CARD_TITLE_CLEAR}>
                    {entry.category.label}
                  </CardTitle>
                  <CardDescription
                    className={cn(typeClass("caption"), "truncate")}
                    title={entry.category.hint}
                  >
                    {entry.category.hint}
                  </CardDescription>
                </CardHeader>
                <CardFooter className="pointer-events-none flex-col items-end gap-0">
                  <span
                    className={cn(
                      typeClass("body"),
                      "text-foreground tabular-nums",
                    )}
                    style={{ fontVariationSettings: fontWeights.semibold }}
                  >
                    {entry.count.toLocaleString("en-US")}
                  </span>
                  <Count>{`${String(Math.round((entry.count / total) * 100))}%`}</Count>
                </CardFooter>
              </Card>
            ))}
          </CardGroup>
        </SizeProvider>
      </div>
    </SectionPanel>
  );
}

const REUSE_LIMIT = 6;

/**
 * The reuse leaderboard: the saved entries with the highest recorded
 * `timesUsed`, i.e. the values the person filled most often. Each row opens
 * its full record. An entry with no recorded use count sits out of this list
 * entirely rather than being ranked at zero.
 */
function ReuseLeaderboard({
  ranked,
  reveal,
  onSelect,
}: {
  readonly ranked: readonly Entry[];
  readonly reveal: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  const top = ranked.slice(0, REUSE_LIMIT);
  const peak = top[0]?.timesUsed ?? 0;
  const listRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();
  const hidesAny = !reveal && top.some(holdsSecret);
  return (
    <SectionPanel
      id="autofill-reuse"
      className="h-full"
      title="Most-used entries"
      description={
        hidesAny
          ? "Saved entries by recorded fills. Payment values stay hidden until Show values is on."
          : "Saved entries by how many times Chrome recorded the value being filled."
      }
    >
      {top.length === 0 ? (
        <ChartEmpty>No saved entry carries a recorded fill count.</ChartEmpty>
      ) : (
        <div ref={listRef} {...hover.handlers} className="relative px-1 pb-1">
          <FluidHoverHighlight hover={hover} className={shape.item} />
          <ol className="flex flex-col">
            {top.map((entry, index) => (
              <ReuseRow
                key={`${entry.category.key}-${String(index)}`}
                index={index}
                registerItem={hover.registerItem}
                entry={entry}
                hidden={!reveal && holdsSecret(entry)}
                peak={peak}
                onOpen={() => {
                  onSelect(entry.row);
                }}
              />
            ))}
          </ol>
        </div>
      )}
    </SectionPanel>
  );
}

function ReuseRow({
  index,
  registerItem,
  entry,
  hidden,
  peak,
  onOpen,
}: {
  readonly index: number;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
  readonly entry: Entry;
  readonly hidden: boolean;
  readonly peak: number;
  readonly onOpen: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const shape = useShape();
  useRegisterFluidHoverItem(registerItem, index, ref);
  const spoken = hidden
    ? `${entry.category.label} value hidden`
    : fieldWord(entry.row.fields.fieldValue);
  return (
    <li>
      <button
        ref={ref}
        type="button"
        onClick={onOpen}
        aria-label={`Open ${spoken}, ${entry.category.label}, filled ${plural(entry.timesUsed, "time", "times")}`}
        className={cn(
          "relative grid h-9 w-full cursor-pointer grid-cols-[1rem_minmax(0,1fr)_4.5rem_auto] items-center gap-3 px-3 text-left outline-none focus-visible:ring-1 focus-visible:ring-focus-ring",
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
        <span className="min-w-0 text-foreground">
          {hidden ? (
            <HiddenValue />
          ) : (
            <FieldCell field={entry.row.fields.fieldValue} />
          )}
        </span>
        <ShareBar fraction={peak === 0 ? 0 : entry.timesUsed / peak} />
        <span className="flex shrink-0 items-baseline gap-1">
          <span
            className={cn(typeClass("body"), "text-foreground tabular-nums")}
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {entry.timesUsed.toLocaleString("en-US")}
          </span>
          <span className={cn(typeClass("caption"), "text-muted-foreground")}>
            {entry.timesUsed === 1 ? "fill" : "fills"}
          </span>
        </span>
      </button>
    </li>
  );
}

/**
 * Saved entries per week, drawn only across the weeks the evidence spans. The
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
    return <ChartEmpty>No dated saved entries to draw.</ChartEmpty>;
  }
  const rows = weeks.map((entry) => ({
    ...entry,
    label: formatDayTick(entry.week),
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

/* ---------------------------------- table --------------------------------- */

const COLUMNS = [
  "Type",
  "Value",
  "Category",
  "Fills",
  "Last used",
  "State",
] as const;

/**
 * The raw rows, with the fields an examiner reads first. TYPE (the field
 * type) is the first column; the full untranslated Chrome name and every
 * other wire field stay reachable in the row detail sheet.
 */
function EntryTable({
  entries,
  reveal,
  onSelect,
}: {
  readonly entries: readonly Entry[];
  readonly reveal: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
      <Table className="min-w-[900px]">
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
          {entries.map((entry, index) => (
            <TableRow
              key={index}
              index={index}
              tabIndex={0}
              aria-label={`Open ${entry.category.label} form entry ${entry.type ?? "of a type not recorded"}`}
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
                  <FieldCell field={entry.row.fields.fieldName} />
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
                {!reveal && holdsSecret(entry) ? (
                  <HiddenValue />
                ) : (
                  <FieldCell field={entry.row.fields.fieldValue} />
                )}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {entry.category.label}
              </TableCell>
              <TableCell className="tabular-nums">
                <FieldCell
                  field={entry.row.fields.timesUsed}
                  format={(value) => Number(value).toLocaleString("en-US")}
                />
              </TableCell>
              <TableCell>
                <TimeCell field={entry.row.fields.dateLastUsed} />
              </TableCell>
              <TableCell>
                <StateWord state={entry.row.commitState} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** One list (saved or recovered) with its loading, error, empty and footer. */
function EntryList({
  list,
  entries,
  visible,
  noun,
  reveal,
  onSelect,
  onClearFilters,
}: {
  readonly list: PaginatedList<Finding>;
  readonly entries: readonly Entry[];
  readonly visible: readonly Entry[];
  readonly noun: "saved" | "recovered";
  readonly reveal: boolean;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} form entry`, many: `${noun} form entries` }}
      shown={visible.length}
      filtered={visible.length !== entries.length}
      onClearFilters={onClearFilters}
      skeletonRows={3}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved Form data rows in this Case."
              : "No form entries were recovered from WAL or journal sidecars."
          }
        />
      }
    >
      <EntryTable entries={visible} reveal={reveal} onSelect={onSelect} />
    </ListBlock>
  );
}

/** Placeholder at the size of the strip, the breakdown, and the chart row. */
function AutofillSkeleton() {
  return (
    <div
      className="flex flex-col gap-5"
      role="status"
      aria-label="Loading form data figures"
    >
      <Skeleton className="h-[170px] w-full rounded-xl lg:h-[98px]" />
      <Skeleton className="h-[190px] w-full rounded-xl" />
      <div className="grid grid-cols-12 gap-4">
        <Skeleton className="col-span-12 h-[320px] rounded-xl lg:col-span-7" />
        <Skeleton className="col-span-12 h-[300px] rounded-xl lg:col-span-5" />
      </div>
    </div>
  );
}

const ALL_CATEGORIES = "__all__";

/* ---------------------------------- page ---------------------------------- */

export function AutofillPage({ config }: { readonly config: ArtifactConfig }) {
  const lists = useCommitStateLists<Finding>(
    config.route,
    AUTOFILL_PARAMETERS,
    {
      drain: AUTOFILL_ROW_CAP,
    },
  );
  const savedDone = lists.drained.saved;
  const tokens = useChartTokens();
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [view, setView] = useState<CommitView>("saved");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  const saved = useMemo(
    () => lists.saved.rows.map(toEntry),
    [lists.saved.rows],
  );
  const recovered = useMemo(
    () => lists.recovered.rows.map(toEntry),
    [lists.recovered.rows],
  );
  const derived = useMemo(() => derive(saved), [saved]);
  const anyPayment = useMemo(
    () => [...saved, ...recovered].some(holdsSecret),
    [saved, recovered],
  );
  const listedCategories = useMemo(() => {
    const keys = new Set(
      [...saved, ...recovered].map((entry) => entry.category.key),
    );
    return FORM_DATA_CATEGORIES.filter((category) => keys.has(category.key));
  }, [saved, recovered]);

  const narrow = useCallback(
    (entries: readonly Entry[]) => {
      const query = search.trim().toLocaleLowerCase("en-US");
      return entries.filter((entry) => {
        if (categoryFilter !== null && entry.category.key !== categoryFilter) {
          return false;
        }
        if (query === "") {
          return true;
        }
        // A hidden Payment value is left out of the search text, so a match
        // can never disclose what it holds.
        const value = !reveal && holdsSecret(entry) ? "" : (entry.value ?? "");
        const haystack = [value, entry.type ?? ""]
          .join("\n")
          .toLocaleLowerCase("en-US");
        return haystack.includes(query);
      });
    },
    [search, categoryFilter, reveal],
  );
  const savedVisible = useMemo(() => narrow(saved), [narrow, saved]);
  const recoveredVisible = useMemo(
    () => narrow(recovered),
    [narrow, recovered],
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const pickCategory = useCallback((key: string) => {
    setCategoryFilter((current) => (current === key ? null : key));
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setCategoryFilter(null);
  }, []);

  const savedFirst = lists.saved.loading && saved.length === 0;
  const recoveredFirst = lists.recovered.loading && recovered.length === 0;
  const pageEmpty =
    !savedFirst &&
    !recoveredFirst &&
    savedDone &&
    lists.saved.error === null &&
    lists.recovered.error === null &&
    saved.length === 0 &&
    recovered.length === 0;
  const figuresReady = savedDone || lists.saved.error !== null;
  const showFigures =
    !figuresReady || (lists.saved.error === null && saved.length > 0);
  const capped = lists.saved.cursor !== null && savedDone;

  const sensitiveShare =
    derived.total === 0
      ? 0
      : Math.round((derived.sensitive / derived.total) * 100);
  const top = derived.ranked[0] ?? null;
  const topHidden = top !== null && !reveal && holdsSecret(top);

  const selectedIsPayment =
    selected !== null &&
    isPaymentField(fieldText(selected.row.fields.fieldName));

  return (
    <div className="flex flex-col gap-5">
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={ClipboardList}
            title="No form data"
            message="No Form data rows in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <div className="reveal-swap">
              <AutofillSkeleton />
              {figuresReady ? (
                <div className="flex flex-col gap-5">
                  {/* Summary strip — four plain readings of the saved
                      entries. "Sensitive" is Identity + Contact + Address +
                      Payment: entries that carry directly identifying or
                      financial data, as opposed to search text. */}
                  <MetricBand className="grid-cols-2 lg:grid-cols-4">
                    <MetricBandItem
                      label="Saved entries"
                      value={`${derived.total.toLocaleString("en-US")}${capped ? "+" : ""}`}
                      detail={
                        capped
                          ? "first pages read; recovered listed apart"
                          : "all profiles; recovered listed apart"
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
                      }}
                    />
                    <MetricBandItem
                      label="Most reused"
                      value={
                        top === null
                          ? "none"
                          : plural(top.timesUsed, "fill", "fills")
                      }
                      detail={
                        top === null
                          ? "no recorded fill counts"
                          : topHidden
                            ? `${top.category.label} value hidden`
                            : fieldWord(top.row.fields.fieldValue)
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
                    <ChartSection
                      className="col-span-12 lg:col-span-7"
                      title="First saved over time"
                      description="When each saved entry was first remembered, per week."
                    >
                      <div className="h-[260px] px-2 pt-2 pb-3">
                        <CreationArea weeks={derived.weeks} tokens={tokens} />
                      </div>
                    </ChartSection>

                    <div className="col-span-12 lg:col-span-5">
                      <ReuseLeaderboard
                        ranked={derived.ranked}
                        reveal={reveal}
                        onSelect={select}
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <SectionPanel
            id="autofill-list"
            title="All form entries"
            description="Saved entries and entries recovered from WAL or journal sidecars are separate lists."
          >
            <CommitStateSplit
              value={view}
              onValueChange={setView}
              label="Saved or recovered form entries"
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
                <>
                  {anyPayment ? (
                    <Switch
                      label="Show values"
                      checked={reveal}
                      onToggle={() => {
                        setReveal((value) => !value);
                      }}
                      className="mr-2"
                    />
                  ) : null}
                  {listedCategories.length > 1 ? (
                    <FilterField label="Category" htmlFor="autofill-category">
                      <Select
                        value={categoryFilter ?? ALL_CATEGORIES}
                        onValueChange={(next) => {
                          setCategoryFilter(
                            next === ALL_CATEGORIES ? null : next,
                          );
                        }}
                      >
                        <SelectTrigger id="autofill-category" />
                        <SelectContent>
                          <SelectItem index={0} value={ALL_CATEGORIES}>
                            All categories
                          </SelectItem>
                          {listedCategories.map((category, index) => (
                            <SelectItem
                              key={category.key}
                              index={index + 1}
                              value={category.key}
                            >
                              {category.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FilterField>
                  ) : null}
                  <FilterTextField
                    commit="change"
                    label="Search loaded form entries"
                    placeholder="Search value or type"
                    icon={Search}
                    value={search}
                    onCommit={setSearch}
                  />
                </>
              }
              saved={
                <EntryList
                  list={lists.saved}
                  entries={saved}
                  visible={savedVisible}
                  noun="saved"
                  reveal={reveal}
                  onSelect={select}
                  onClearFilters={clearFilters}
                />
              }
              recovered={
                <EntryList
                  list={lists.recovered}
                  entries={recovered}
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
          title={
            readableFieldType(fieldText(selected.row.fields.fieldName)) ??
            "Form entry"
          }
          redactedFields={selectedIsPayment ? PAYMENT_SECRET_FIELDS : undefined}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
