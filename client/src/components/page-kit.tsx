/**
 * The shared page kit: presentation parts every evidence page composes,
 * built from Fluid Functionalism pieces. They hold no data logic — each page
 * reads and filters its own rows and hands these parts plain values.
 *
 * Formatting
 *  - `formatBytes`, `plural`, `formatDay`, `formatDayTick`, `formatDaySpan`,
 *    `CHART_HEIGHT`.
 * Text
 *  - `TimeText` / `TimeCell` (UTC instant or the word "absent"), `Count`,
 *    `WeightLabel` (semibold-when-active without reflow), `CountChips`
 *    (chip filters with counts).
 * Layout
 *  - `ResponsiveRows` (an FF Table above `sm`, stacked row cards on a
 *    phone; one column list with a `stack` role per column),
 *  - `SectionPanel` (a Panel with title, count, description, trailing aside),
 *    `Toolbar` (a compact filter bar), `IconTile`.
 * Bars
 *  - `ShareBar` (a share-of-peak pill),
 *    `CARD_TITLE_CLEAR`.
 * Saved / recovered (forensic rule 4)
 *  - `CommitStateTabs`, `CommitStateSplit` (tabs or stacked), and
 *    `splitByCommit` for the one route that cannot filter by Commit State
 *    (Cache). Pair the tabs with `useCommitStateLists` from
 *    `src/use-commit-state-lists.ts`, which reads each Commit State as its
 *    own server query.
 *
 * Forensic rules kept here: a missing time is the word "absent"; sidecar
 * (WAL / rollback-journal) rows are a separate list from saved rows and never
 * sorted in.
 */
import { useRef, useState, type ComponentProps, type ReactNode } from "react";

import {
  Panel,
  PanelDescription,
  PanelHeader,
  PanelTitle,
  type HeadingTag,
} from "@/components/panel";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { RefreshIcon, type AppIcon } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { FieldState, Finding } from "../types.js";
import { Term, TermTooltip } from "./term.js";
import { SERIES } from "./charts.js";
import {
  AbsentWord,
  FieldCell,
  fieldUtc,
  formatInstant,
} from "./finding-fields.js";

/** Table above `sm`, stacked row cards below (see responsive-rows.tsx). */
export { ResponsiveRows, type RowColumn } from "./responsive-rows.js";

/* -------------------------------- formatting ------------------------------- */

/** Bytes as "1.4 MB" / "812 KB" / "312 B" — base-1024, one decimal below
 *  100 units. Presentation only: the exact byte count stays reachable in the
 *  row detail sheet (put it in a `title` where the short form is shown). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded =
    value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString("en-US")} ${units[unit] ?? "KB"}`;
}

/** "1 visit" / "1,204 visits". */
export function plural(count: number, one: string, many: string): string {
  return `${count.toLocaleString("en-US")} ${count === 1 ? one : many}`;
}

function parseDay(date: string): Date | null {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** A `YYYY-MM-DD` day as "4 Mar 2024" (UTC); unparseable input is returned
 *  as is. Chart tooltips and range labels. */
export function formatDay(date: string): string {
  const parsed = parseDay(date);
  return parsed === null
    ? date
    : parsed.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      });
}

/** A `YYYY-MM-DD` day as "4 Mar" (UTC), for chart axis ticks. */
export function formatDayTick(date: string): string {
  const parsed = parseDay(date);
  return parsed === null
    ? date
    : parsed.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      });
}

/** A recorded span as data, shortened: "11 Mar - 17 Apr" within one year,
 *  "9 Dec 2023 - 4 Jan 2024" across years, "4 Mar 2024" for one day. */
export function formatDaySpan(first: string, last: string): string {
  if (first === last) {
    return formatDay(first);
  }
  return first.slice(0, 4) === last.slice(0, 4)
    ? `${formatDayTick(first)} - ${formatDayTick(last)}`
    : `${formatDay(first)} - ${formatDay(last)}`;
}

/** Height of a page's over-time chart, shared by the chart and its
 *  skeleton so the swap never jumps. */
export const CHART_HEIGHT = "h-[220px]";

/* ---------------------------------- text ----------------------------------- */

/**
 * A timestamp on one line: "9 Dec 2024 14:32:07" (UTC). The date takes the
 * surrounding colour (so a lit table row lifts it); the time stays muted; the
 * full instant is the hover title. `TimeText` sets the body role (follows the
 * SizeProvider); `TimeCell` inherits the cell's type instead.
 *
 * Pass the FieldState as `field` (preferred): a recorded instant renders as
 * above, and every other state keeps its own word — "absent", "(empty)", or
 * "unavailable - reason" (`FieldCell`). Passing a bare `utc` string (from
 * `fieldUtc`) still works, but then `null` can only read "absent".
 */
export function TimeText({
  field,
  utc,
  inheritType = false,
  className,
}: {
  /** The timestamp field (`{ utc, … }` value shape). */
  readonly field?: FieldState;
  /** A bare UTC instant; used when `field` is not given. */
  readonly utc?: string | null;
  /** Leave the type size to the parent (a table cell). */
  readonly inheritType?: boolean;
  readonly className?: string;
}) {
  const size = useSize();
  const instant = utc !== undefined ? utc : fieldUtc(field);
  const parts = instant === null ? null : formatInstant(instant);
  if (instant === null || parts === null) {
    return utc !== undefined || field === undefined ? (
      <AbsentWord />
    ) : (
      <FieldCell field={field} className={className} />
    );
  }
  return (
    <span
      className={cn(
        !inheritType && size.type.body,
        "whitespace-nowrap tabular-nums",
        className,
      )}
      title={`${instant} (UTC)`}
    >
      {parts.date}
      <span className="ml-2 text-muted-foreground">{parts.time}</span>
    </span>
  );
}

/** `TimeText` for a table cell: inherits the cell's type role. Prefer
 *  `<TimeCell field={row.fields.visitTime} />`. */
export function TimeCell({
  field,
  utc,
}: {
  readonly field?: FieldState;
  readonly utc?: string | null;
}) {
  return <TimeText field={field} utc={utc} inheritType />;
}

/** A count beside a title: caption role (follows the SizeProvider), muted,
 *  tabular. A number is grouped ("1,204"); anything else renders as is. */
export function Count({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const size = useSize();
  return (
    <span
      className={cn(
        size.type.caption,
        "text-muted-foreground tabular-nums",
        className,
      )}
    >
      {typeof children === "number"
        ? children.toLocaleString("en-US")
        : children}
    </span>
  );
}

/** One chip of a `CountChips` row. */
export interface CountChip {
  readonly key: string;
  readonly label: string;
  readonly count: number;
}

/**
 * A one-of chip filter with counts, the one look for every such row
 * (Timeline event types, Form data categories), composed from FF parts:
 * 28px pills, "All N" first, then each chip as its label and a muted,
 * tabular count; one selected pill (`bg-active`, semibold label without
 * reflow) and FF's fluid hover highlight gliding between pills
 * (`useFluidHover` on both axes, so a wrapped second row tracks too). From
 * `sm` up the row wraps onto a second line instead of scrolling; below it
 * scrolls sideways with no scrollbar, its edges fading (`scroll-fade-x`).
 * It sits in the list `Toolbar`'s trailing controls. `null` is "All".
 */
export function CountChips({
  label,
  allLabel = "All",
  total,
  chips,
  active,
  onChange,
}: {
  /** Accessible name of the chip row. */
  readonly label: string;
  /** @default "All" */
  readonly allLabel?: string;
  /** Rows the "All" chip counts. */
  readonly total: number;
  readonly chips: readonly CountChip[];
  readonly active: string | null;
  readonly onChange: (key: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(containerRef, { axis: "xy" });
  const shape = useShape();
  const items: readonly {
    readonly key: string | null;
    readonly label: string;
    readonly count: number;
  }[] = [{ key: null, label: allLabel, count: total }, ...chips];
  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={label}
      className="scroll-fade-x scrollbar-hide relative flex min-w-0 items-center gap-0.5 p-0.5 max-sm:w-full max-sm:overflow-x-auto sm:flex-wrap"
      {...hover.handlers}
    >
      <FluidHoverHighlight hover={hover} className={shape.bg} />
      {items.map((item, index) => (
        <CountChipButton
          key={item.key ?? "all"}
          index={index}
          label={item.label}
          count={item.count}
          selected={item.key === active}
          registerItem={hover.registerItem}
          onSelect={() => {
            onChange(item.key);
          }}
        />
      ))}
    </div>
  );
}

function CountChipButton({
  index,
  label,
  count,
  selected,
  registerItem,
  onSelect,
}: {
  readonly index: number;
  readonly label: string;
  readonly count: number;
  readonly selected: boolean;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
  readonly onSelect: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  const size = useSize();
  const shape = useShape();
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "relative z-10 inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap outline-none transition-colors duration-80 focus-visible:ring-1 focus-visible:ring-focus-ring",
        size.control,
        size.px,
        size.type.body,
        shape.bg,
        selected ? "bg-active text-foreground" : "text-muted-foreground",
      )}
    >
      <WeightLabel
        text={label}
        active={selected}
        className={selected ? "text-foreground" : undefined}
      />
      <span className="text-muted-foreground tabular-nums">
        {count.toLocaleString("en-US")}
      </span>
    </button>
  );
}

/**
 * A label that turns semibold when active without moving its neighbours:
 * FF's ghost-span pattern (an invisible semibold copy reserves the width),
 * truncating inside a grid cell. Use for a selected list row or a lit bar.
 */
export function WeightLabel({
  text,
  active,
  className,
}: {
  readonly text: string;
  readonly active: boolean;
  readonly className?: string;
}) {
  return (
    <span className={cn("inline-grid min-w-0", className)} title={text}>
      <span
        className="col-start-1 row-start-1 truncate transition-[font-variation-settings] duration-80"
        style={{
          fontVariationSettings: active
            ? fontWeights.semibold
            : fontWeights.normal,
        }}
      >
        {text}
      </span>
      <span
        aria-hidden="true"
        className="invisible col-start-1 row-start-1 truncate"
        style={{ fontVariationSettings: fontWeights.semibold }}
      >
        {text}
      </span>
    </span>
  );
}

/* --------------------------------- layout ---------------------------------- */

/**
 * A framed section: a Panel whose header carries the title (subtitle role),
 * an optional count beside it, an optional description under it, and an
 * optional trailing `aside` (a badge, a Tabs switch, an action — on the
 * compact 28px step, like every toolbar control). With `id` the panel is a
 * labelled region.
 */
export function SectionPanel({
  id,
  title,
  headingAs,
  description,
  count,
  aside,
  className,
  children,
}: {
  readonly id?: string;
  readonly title: ReactNode;
  /** The title's heading element. @default "h2" */
  readonly headingAs?: HeadingTag;
  readonly description?: ReactNode;
  readonly count?: ReactNode;
  readonly aside?: ReactNode;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <Panel
      role={id === undefined ? undefined : "region"}
      aria-labelledby={id}
      className={cn("overflow-clip", className)}
    >
      <PanelHeader className="flex-nowrap items-center">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <PanelTitle id={id} as={headingAs}>
              {title}
            </PanelTitle>
            {count === undefined ? null : <Count>{count}</Count>}
          </div>
          {description === undefined ? null : (
            <PanelDescription>{description}</PanelDescription>
          )}
        </div>
        {aside === undefined || aside === null ? null : (
          // Header controls sit on the toolbar's 28px step, like
          // ChartSection's action, so a panel never mixes control heights.
          <SizeProvider size="compact">{aside}</SizeProvider>
        )}
      </PanelHeader>
      {children}
    </Panel>
  );
}

/** A 32px tinted tile holding one muted icon (FF's CardMedia treatment). */
export function IconTile({
  icon: Icon,
  className,
}: {
  readonly icon: AppIcon;
  readonly className?: string;
}) {
  const size = useSize();
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover",
        className,
      )}
    >
      <Icon
        size={size.icon}
        strokeWidth={1.5}
        className="text-muted-foreground"
      />
    </span>
  );
}

/**
 * The list toolbar: every control inside sits on the 28px ladder (one
 * compact `SizeProvider`), gaps from `useSize().gap`, wrapping on narrow
 * screens.
 *
 * `placement="panel"` (default, the canonical place): directly under the
 * list's `PanelHeader`, padded `px-4 pt-1 pb-3`. The `start` slot (the
 * `CommitStateTabs` switch) sits on the left; `children` — filters
 * (`FilterField` + Select, `ProfilePicker`), then `FilterTextField` last —
 * are pushed right with `ml-auto`.
 *
 * `placement="inline"`: no padding, controls in one wrapping row 20px apart —
 * for a toolbar placed in another container's slot (e.g. a SectionHeading's
 * trailing children).
 */
export function Toolbar({
  start,
  children,
  placement = "panel",
  className,
}: {
  /** Leading control, usually `CommitStateTabs`. */
  readonly start?: ReactNode;
  /** Trailing filters; `FilterTextField` last. */
  readonly children?: ReactNode;
  readonly placement?: "panel" | "inline";
  readonly className?: string;
}) {
  return (
    <SizeProvider size="compact">
      {placement === "inline" ? (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-5 gap-y-2 max-sm:w-full",
            className,
          )}
        >
          {start}
          {children}
        </div>
      ) : (
        <PanelToolbar start={start} className={className}>
          {children}
        </PanelToolbar>
      )}
    </SizeProvider>
  );
}

function PanelToolbar({
  start,
  children,
  className,
}: {
  readonly start?: ReactNode;
  readonly children?: ReactNode;
  readonly className?: string;
}) {
  const size = useSize();
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-y-2 px-4 pt-1 pb-3",
        size.gap,
        className,
      )}
    >
      {start}
      {children === undefined || children === null ? null : (
        <div
          className={cn(
            "ml-auto flex flex-wrap items-center max-sm:w-full",
            size.gap,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- bars ----------------------------------- */

/**
 * A share of the busiest entry: a full-width pill slid in from the left
 * inside a clipping track (translateX, never a scaled or width-animated bar),
 * in the one series style (ink): the peak (fraction 1, or `peak`) at full
 * strength, every other bar at rest.
 * Decorative — the figure it draws must be printed beside it.
 */
export function ShareBar({
  fraction,
  peak,
  className,
}: {
  /** Share of the busiest entry, 0–1. */
  readonly fraction: number;
  /** Force the full-strength fill. @default fraction >= 1 */
  readonly peak?: boolean;
  /** Extra classes for the fill (e.g. an evidence hue `bg-wal`). */
  readonly className?: string;
}) {
  const clamped = Math.min(1, Math.max(0, fraction));
  const isPeak = peak ?? clamped >= 1;
  return (
    <span
      aria-hidden="true"
      className="block h-1.5 w-full overflow-hidden rounded-full bg-hover"
    >
      <span
        className={cn("block h-full w-full rounded-full", className)}
        style={{
          backgroundColor:
            className === undefined ? "var(--foreground)" : undefined,
          opacity: isPeak ? SERIES.emphasis : SERIES.rest,
          transform: `translateX(${String((clamped - 1) * 100)}%)`,
        }}
      />
    </span>
  );
}

/** Lets an FF CardTitle's ghost-span stay on one line without clipping its
 *  ascenders (`<CardTitle className={CARD_TITLE_CLEAR}>`). */
export const CARD_TITLE_CLEAR =
  "whitespace-nowrap [&>span]:-my-1 [&>span]:py-1";

/* ----------------------------- saved / recovered ---------------------------- */

/** Saved rows and sidecar (WAL / rollback-journal) rows, kept apart. Only for
 *  a route that cannot filter by Commit State (Cache) or rows already loaded
 *  together (a Sites drill-down); everything else reads each state on its own
 *  with `useCommitStateLists`. */
export function splitByCommit<Row extends Pick<Finding, "commitState">>(
  rows: readonly Row[],
): { readonly saved: readonly Row[]; readonly recovered: readonly Row[] } {
  const saved: Row[] = [];
  const recovered: Row[] = [];
  for (const row of rows) {
    if (row.commitState === "committed") {
      saved.push(row);
    } else {
      recovered.push(row);
    }
  }
  return { saved, recovered };
}

/** What "Recovered" means, in plain words: the one explanation, on the
 *  Recovered tab and the stacked "Recovered" sub-heading alike. */
const RECOVERED_NOTE =
  "Rows found only in Chrome's temporary database files (write-ahead log or rollback journal). They can include entries that were deleted or overwritten in the saved database.";

/** The Recovered tab with `RECOVERED_NOTE` as its tooltip. TabsList reads
 *  `value` and hands `_index` to its children, so both pass through. */
function RecoveredTabItem(props: ComponentProps<typeof TabItem>) {
  return (
    <TermTooltip content={RECOVERED_NOTE}>
      <TabItem {...props} />
    </TermTooltip>
  );
}

/** Which list a CommitStateSplit shows. */
export type CommitView = "saved" | "recovered";

function countLabel(word: string, count: number | null, more: boolean) {
  if (count === null) {
    return word;
  }
  return `${word} ${count.toLocaleString("en-US")}${more ? "+" : ""}`;
}

/**
 * The saved / recovered switch: an FF Tabs segmented control reading
 * "Saved N" · "Recovered N". N is the loaded row count; `+` follows it while
 * the server has more (`more`). `null` hides the count (still loading).
 */
function CommitStateTabs({
  value,
  onValueChange,
  saved,
  recovered,
  savedMore = false,
  recoveredMore = false,
  label = "Saved or recovered rows",
  className,
}: {
  readonly value: CommitView;
  readonly onValueChange: (next: CommitView) => void;
  readonly saved: number | null;
  readonly recovered: number | null;
  readonly savedMore?: boolean;
  readonly recoveredMore?: boolean;
  /** Accessible name of the switch (e.g. "Saved or recovered visits"). */
  readonly label?: string;
  readonly className?: string;
}) {
  return (
    <Tabs
      value={value}
      onValueChange={(next) => {
        onValueChange(next === "recovered" ? "recovered" : "saved");
      }}
      className={className}
    >
      <TabsList aria-label={label}>
        <TabItem value="saved" label={countLabel("Saved", saved, savedMore)} />
        <RecoveredTabItem
          value="recovered"
          label={countLabel("Recovered", recovered, recoveredMore)}
        />
      </TabsList>
    </Tabs>
  );
}

interface CommitStateSplitCounts {
  /** Loaded saved rows (`null` while the first read is in flight). */
  readonly savedCount: number | null;
  /** Loaded recovered rows (`null` while the first read is in flight). */
  readonly recoveredCount: number | null;
  /** The server has more saved rows (a cursor stands). */
  readonly savedMore?: boolean;
  /** The server has more recovered rows. */
  readonly recoveredMore?: boolean;
  /** The saved list (table, empty state, footer). */
  readonly saved: ReactNode;
  /** The recovered list (table, empty state, footer). */
  readonly recovered: ReactNode;
  readonly className?: string;
}

/**
 * One saved/recovered pattern for the whole app (forensic rule 4).
 *
 * `variant="tabs"` (default) — for a full artifact table. Sits inside a
 * Panel, under its PanelHeader: a compact row with the `CommitStateTabs`
 * switch and any trailing `toolbar` controls, a hairline, then the active
 * list. The other list unmounts; its data lives in the page's
 * `useCommitStateLists`, so switching never refetches. Controlled with
 * `value` + `onValueChange`, or uncontrolled from `defaultValue`.
 *
 * `variant="stacked"` — only for a small embedded table (a Sites drill-down
 * panel): the saved list, then — only when there are recovered rows — a
 * hairline, a "Recovered N" sub-heading (its tooltip says the rows come from
 * the write-ahead log or rollback journal), and the recovered list. Saved rows always come first.
 */
export function CommitStateSplit(
  props: CommitStateSplitCounts &
    (
      | {
          readonly variant?: "tabs";
          readonly value?: CommitView;
          readonly defaultValue?: CommitView;
          readonly onValueChange?: (next: CommitView) => void;
          /** Trailing controls on the switch row (search, filters). */
          readonly toolbar?: ReactNode;
          /** Accessible name of the switch. */
          readonly label?: string;
        }
      | {
          readonly variant: "stacked";
          /** The "Recovered" sub-heading's element, one below the
           *  enclosing panel's title. @default "h3" */
          readonly headingAs?: HeadingTag;
        }
    ),
) {
  if (props.variant === "stacked") {
    return <StackedSplit {...props} />;
  }
  return <TabbedSplit {...props} />;
}

function TabbedSplit({
  value,
  defaultValue = "saved",
  onValueChange,
  toolbar,
  label,
  savedCount,
  recoveredCount,
  savedMore = false,
  recoveredMore = false,
  saved,
  recovered,
  className,
}: CommitStateSplitCounts & {
  readonly value?: CommitView;
  readonly defaultValue?: CommitView;
  readonly onValueChange?: (next: CommitView) => void;
  readonly toolbar?: ReactNode;
  readonly label?: string;
}) {
  const [own, setOwn] = useState<CommitView>(defaultValue);
  const view = value ?? own;
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <Toolbar
        start={
          <CommitStateTabs
            value={view}
            onValueChange={(next) => {
              setOwn(next);
              onValueChange?.(next);
            }}
            saved={savedCount}
            recovered={recoveredCount}
            savedMore={savedMore}
            recoveredMore={recoveredMore}
            label={label}
          />
        }
      >
        {toolbar}
      </Toolbar>
      <div className="min-w-0 border-t border-border">
        {view === "saved" ? saved : recovered}
      </div>
    </div>
  );
}

function StackedSplit({
  recoveredCount,
  recoveredMore = false,
  headingAs: Heading = "h3",
  saved,
  recovered,
  className,
}: CommitStateSplitCounts & {
  readonly headingAs?: HeadingTag;
}) {
  const size = useSize();
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      {saved}
      {recoveredCount === null || recoveredCount === 0 ? null : (
        <div className="border-t border-border pt-3">
          <div className="flex flex-wrap items-center gap-x-2 px-4">
            <RefreshIcon
              size={size.icon}
              strokeWidth={1.5}
              className="text-muted-foreground"
            />
            <Heading
              className={cn(typeClass("body"), "text-foreground")}
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              <Term label="Recovered">
                Rows read from the write-ahead log or rollback journal: not part
                of the saved database.
              </Term>
            </Heading>
            <Count>
              {recoveredCount.toLocaleString("en-US")}
              {recoveredMore ? "+" : ""}
            </Count>
          </div>
          {recovered}
        </div>
      )}
    </div>
  );
}
