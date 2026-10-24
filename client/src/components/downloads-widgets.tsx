/**
 * The Downloads widgets: bytes per Case day (`VolumeChart`, the shared
 * `DayBars`, which drives the page's date range) and the file kinds
 * (`KindBreakdown`). Split out of `downloads-page.tsx`.
 */
import { useMemo, useRef } from "react";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import {
  ChartTooltipNote,
  ChartTooltipValue,
  useChartTokens,
} from "./charts.js";
import { DayBars } from "./charts-ready.js";
import { EmptyRows } from "./data-table.js";
import { caseDayTotals } from "./day-bounds.js";
import {
  CHART_HEIGHT,
  ShareBar,
  formatBytes,
  plural,
  WeightLabel,
} from "./page-kit.js";
import {
  type FileKind,
  KIND_META,
  KIND_ORDER,
  type DayRange,
  type DownloadRow,
} from "./downloads-model.js";

/* -------------------------------- widgets --------------------------------- */

/**
 * Round byte ticks for a peak: a 1, 2, 2.5 or 5 step (×10ⁿ) of the
 * peak's own unit (B, KB, MB, …, base 1024 as `formatBytes` reads them), at
 * most five ticks from zero, the last one at or above the peak - so the axis
 * reads "10 MB / 20 MB / 30 MB / 40 MB" instead of "9.5 / 19.1 / 28.6 MB".
 */
export function byteTicks(peak: number): readonly number[] {
  if (peak <= 0) {
    return [0];
  }
  let unit = 1;
  while (peak / unit >= 1024 && unit < 1024 ** 4) {
    unit *= 1024;
  }
  const scaled = peak / unit;
  const magnitude = 10 ** Math.floor(Math.log10(scaled / 4));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((factor) => factor * magnitude)
      .find((candidate) => scaled / candidate <= 4) ?? 10 * magnitude;
  const count = Math.ceil(scaled / step - 1e-9);
  return Array.from({ length: count + 1 }, (_, index) => index * step * unit);
}

export interface VolumeDay {
  readonly date: string;
  readonly bytes: number;
  readonly count: number;
}

/**
 * Downloads over time. Bars show the bytes Chrome recorded as received per
 * Case day the download started on (`receivedBytes`, never the expected
 * `totalBytes`: an interrupted transfer counts what arrived) on the shared
 * `DayBars` (one per-day chart everywhere: click, tap, drag or the keyboard
 * picks the page's range). Days with no downloads are filled with zero
 * (drawn as nothing) so the axis is continuous calendar time, never
 * compressed. Round byte ticks (`byteTicks`).
 */
export function VolumeChart({
  rows,
  range,
  onRangeChange,
  timeZone,
}: {
  readonly rows: readonly DownloadRow[];
  readonly range: DayRange;
  readonly onRangeChange: (range: DayRange) => void;
  /** The Case's declared timezone (`useCaseTimeZone`); null = UTC days. */
  readonly timeZone: string | null;
}) {
  const tokens = useChartTokens();

  const days = useMemo<readonly VolumeDay[]>(() => {
    const recorded = caseDayTotals(
      rows,
      (row) => row.startUtc,
      timeZone,
      (row) => row.received ?? 0,
    ).map(({ date, count, weight }) => ({ date, bytes: weight, count }));
    const first = recorded[0];
    const last = recorded[recorded.length - 1];
    if (first === undefined || last === undefined) {
      return recorded;
    }
    const start = new Date(`${first.date}T00:00:00Z`).getTime();
    const end = new Date(`${last.date}T00:00:00Z`).getTime();
    const span = Math.round((end - start) / 86_400_000) + 1;
    // Gap-fill only when it stays cheap; otherwise draw the recorded days
    // straight, same guard the Timeline activity chart uses.
    if (span <= recorded.length || span > 550) {
      return recorded;
    }
    const map = new Map(recorded.map((day) => [day.date, day]));
    return Array.from({ length: span }, (_, index) => {
      const date = new Date(start + index * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return map.get(date) ?? { date, bytes: 0, count: 0 };
    });
  }, [rows, timeZone]);

  const peak = days.reduce((max, day) => Math.max(max, day.bytes), 0);
  const ticks = byteTicks(peak);

  return (
    <div className={cn(CHART_HEIGHT, "w-full")}>
      <DayBars
        days={days}
        value={bytesOf}
        tokens={tokens}
        title="Bytes received per day"
        formatValue={formatBytes}
        axis={{
          width: 56,
          ticks,
          domain: [0, ticks[ticks.length - 1] ?? 0],
          tickFormatter: formatBytes,
        }}
        range={range}
        onRangeChange={onRangeChange}
        emptyMessage="No dated downloads to draw."
        tooltip={(day, note) => (
          <>
            <ChartTooltipValue value={formatBytes(day.bytes)} unit="received" />
            <ChartTooltipNote>
              {plural(day.count, "file", "files")}
              {note === null ? "" : ` · ${note.toLowerCase()}`}
            </ChartTooltipNote>
          </>
        )}
      />
    </div>
  );
}

function bytesOf(day: VolumeDay): number {
  return day.bytes;
}

/**
 * File-kind breakdown. One row per kind that appears, ordered investigative
 * first (executables, archives), each with a bar sized to the busiest kind by
 * received bytes and, at the row's end, its file count and the bytes
 * received - size last
 * and in the foreground, since the bar measures bytes. This is the lens an
 * examiner actually scans a downloads set through - "did anything
 * executable land here" - that the raw table alone buries. Picking a kind
 * focuses the table (picking it again clears); the picked row holds the
 * selection fill and its label turns semibold. A fluid-hover list of 40px
 * button rows (FLUID's clickable-list pattern) keeps the panel no taller
 * than the chart beside it.
 */
export function KindBreakdown({
  rows,
  activeKind,
  onKind,
  emptyMessage = "No saved downloads to classify.",
}: {
  readonly rows: readonly DownloadRow[];
  readonly activeKind: FileKind | null;
  readonly onKind: (kind: FileKind | null) => void;
  /** Words when no row is in scope (the range's days, say). */
  readonly emptyMessage?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();
  const kinds = useMemo(() => {
    const map = new Map<FileKind, { count: number; bytes: number }>();
    for (const row of rows) {
      const entry = map.get(row.kind) ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += row.received ?? 0;
      map.set(row.kind, entry);
    }
    return KIND_ORDER.flatMap((kind) => {
      const entry = map.get(kind);
      return entry === undefined ? [] : [{ kind, ...entry }];
    });
  }, [rows]);

  // Bars are sized by bytes, not count: the whole page reads download volume
  // (the over-time chart is bytes too), so one 2 GB
  // executable must not shrink to the width of a single favicon.
  const peak = Math.max(...kinds.map((entry) => entry.bytes), 1);

  if (kinds.length === 0) {
    return <EmptyRows message={emptyMessage} />;
  }

  return (
    <div ref={listRef} {...hover.handlers} className="relative px-1 pb-1">
      <FluidHoverHighlight hover={hover} className={shape.item} />
      <ul className="flex flex-col">
        {kinds.map((entry, index) => (
          <KindRow
            key={entry.kind}
            index={index}
            registerItem={hover.registerItem}
            kind={entry.kind}
            count={entry.count}
            bytes={entry.bytes}
            fraction={entry.bytes / peak}
            active={activeKind === entry.kind}
            onPick={() => {
              onKind(activeKind === entry.kind ? null : entry.kind);
            }}
          />
        ))}
      </ul>
    </div>
  );
}

function KindRow({
  index,
  registerItem,
  kind,
  count,
  bytes,
  fraction,
  active,
  onPick,
}: {
  readonly index: number;
  readonly registerItem: (index: number, element: HTMLElement | null) => void;
  readonly kind: FileKind;
  readonly count: number;
  readonly bytes: number;
  readonly fraction: number;
  readonly active: boolean;
  readonly onPick: () => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const shape = useShape();
  const size = useSize();
  useRegisterFluidHoverItem(registerItem, index, ref);
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  return (
    <li>
      <button
        ref={ref}
        type="button"
        aria-pressed={active}
        aria-label={`${meta.label}: ${formatBytes(bytes)} received, ${plural(count, "file", "files")}. ${
          active
            ? "Press to show every file kind"
            : "Press to focus the table on this kind"
        }`}
        onClick={onPick}
        className={cn(
          "relative grid h-10 w-full cursor-pointer grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 px-3 text-left transition-colors duration-80",
          "outline-none focus-visible:ring-1 focus-visible:ring-focus-ring",
          shape.item,
          active && "bg-active",
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon
            aria-hidden="true"
            size={size.icon}
            strokeWidth={active ? 2 : 1.5}
            className={cn(
              "shrink-0 transition-colors duration-80",
              active ? "text-foreground" : "text-muted-foreground",
            )}
          />
          <WeightLabel
            text={meta.label}
            active={active}
            className={cn(size.type.body, "text-foreground")}
          />
        </span>
        <ShareBar fraction={fraction} />
        <span className="flex items-baseline justify-end gap-2 whitespace-nowrap">
          <span
            className={cn(
              size.type.caption,
              "text-muted-foreground tabular-nums",
            )}
          >
            {plural(count, "file", "files")}
          </span>
          <span
            className={cn(
              size.type.body,
              "w-16 text-right text-foreground tabular-nums",
            )}
          >
            {formatBytes(bytes)}
          </span>
        </span>
      </button>
    </li>
  );
}
