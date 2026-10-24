/**
 * The Downloads widgets: bytes per day (`VolumeChart`, which drives the
 * page's date range by hand with the `ActivityBars` rules) and the file
 * kinds (`KindBreakdown`). Split out of `downloads-page.tsx`.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
  type MouseHandlerDataParam,
} from "recharts";
import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
} from "@/hooks/use-fluid-hover";
import { useShape } from "@/lib/shape-context";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import {
  activeIndexOf,
  CHART_FOCUS_CLASS,
  chartAnimation,
  chartAxis,
  chartGrid,
  ChartEmpty,
  ChartTooltipCard,
  chartTooltipMotion,
  ChartTooltipNote,
  ChartTooltipValue,
  chartRange,
  FluidBandCursor,
  SeriesBar,
  seriesColor,
  tooltipEntry,
  useChartTokens,
  usePrefersReducedMotion,
} from "./charts.js";
import { EmptyRows } from "./data-table.js";
import {
  CHART_HEIGHT,
  ShareBar,
  formatBytes,
  formatDay,
  formatDayTick,
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
 * Downloads over time. Bars show bytes transferred per recorded day — a
 * discrete reading of when data actually left the machine. Days with no
 * downloads are filled with zero (drawn as nothing) so the axis is
 * continuous calendar time, never compressed. Drag across the bars (or
 * click one) to focus the lists. The one series style: ink bars at rest,
 * one emphasis — the picked day, else the busiest — and the rest dimmed
 * outside a picked range.
 */
export function VolumeChart({
  rows,
  range,
  onRangeChange,
}: {
  readonly rows: readonly DownloadRow[];
  readonly range: DayRange;
  readonly onRangeChange: (range: DayRange) => void;
}) {
  const tokens = useChartTokens();
  const reduced = usePrefersReducedMotion();
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragCurrent, setDragCurrent] = useState<string | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const hasRange = range.from !== "" || range.to !== "";
  const dragging = dragStart !== null;

  // While dragging the highlight follows the pointer; once committed it is the
  // page's own range. Bounds are kept sorted so a right-to-left drag reads the
  // same as a left-to-right one — identical to the Timeline activity card.
  const highlight = useMemo(() => {
    if (dragStart !== null && dragCurrent !== null) {
      return dragStart <= dragCurrent
        ? { from: dragStart, to: dragCurrent }
        : { from: dragCurrent, to: dragStart };
    }
    if (dragStart !== null) {
      return { from: dragStart, to: dragStart };
    }
    if (!hasRange) {
      return null;
    }
    // An unset bound is open-ended, exactly as the table filters: it reaches
    // the chart's first or last day, never collapses onto the other bound.
    return {
      from: range.from === "" ? "" : range.from,
      to: range.to === "" ? "\uffff" : range.to,
    };
  }, [dragStart, dragCurrent, hasRange, range]);

  // A press on one day is a click (that day, or the full span when it is
  // already the range — as ActivityBars reads); a drag sets the span.
  const commitDrag = useCallback(() => {
    if (dragStart === null) {
      return;
    }
    const end = dragCurrent ?? dragStart;
    onRangeChange(
      dragStart === end && range.from === end && range.to === end
        ? { from: "", to: "" }
        : dragStart <= end
          ? { from: dragStart, to: end }
          : { from: end, to: dragStart },
    );
    setDragStart(null);
    setDragCurrent(null);
  }, [dragStart, dragCurrent, onRangeChange, range]);

  const days = useMemo<readonly VolumeDay[]>(() => {
    const byDate = new Map<string, { bytes: number; count: number }>();
    for (const row of rows) {
      if (row.startUtc === null) {
        continue;
      }
      const date = row.startUtc.slice(0, 10);
      const entry = byDate.get(date) ?? { bytes: 0, count: 0 };
      entry.bytes += row.bytes ?? 0;
      entry.count += 1;
      byDate.set(date, entry);
    }
    const recorded = [...byDate.entries()]
      .map(([date, entry]) => ({ date, ...entry }))
      .sort((left, right) => left.date.localeCompare(right.date));
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
  }, [rows]);

  if (days.length === 0) {
    return (
      <div className={CHART_HEIGHT}>
        <ChartEmpty>No dated downloads to draw.</ChartEmpty>
      </div>
    );
  }

  const peak = days.reduce((max, day) => Math.max(max, day.bytes), 0);
  const ticks = byteTicks(peak);
  const dateAt = (state: MouseHandlerDataParam | undefined) => {
    const index = activeIndexOf(state);
    return index === null ? null : (days[index]?.date ?? null);
  };
  // One emphasis: the selection when there is one (the picked day or
  // span), else the busiest; days outside the range dim — as ActivityBars
  // reads.
  const emphasisOf = (day: VolumeDay) =>
    highlight !== null
      ? day.bytes > 0 && day.date >= highlight.from && day.date <= highlight.to
      : peak > 0 && day.bytes === peak;
  const dimmedOf = (day: VolumeDay) =>
    highlight !== null &&
    (day.date < highlight.from || day.date > highlight.to);
  // The shaded band, clamped to the drawn days (an open bound runs to the
  // chart's edge).
  const firstDay = days[0]?.date ?? "";
  const lastDay = days[days.length - 1]?.date ?? "";
  const band =
    highlight === null
      ? null
      : {
          from: highlight.from < firstDay ? firstDay : highlight.from,
          to: highlight.to > lastDay ? lastDay : highlight.to,
        };

  return (
    <div
      className={cn(
        CHART_HEIGHT,
        "w-full",
        dragging && "cursor-crosshair select-none",
      )}
      aria-label="Bytes downloaded per day. Drag across the chart to focus the table below."
    >
      <ResponsiveContainer
        width="100%"
        height="100%"
        className={CHART_FOCUS_CLASS}
      >
        <BarChart
          data={days as VolumeDay[]}
          margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
          barCategoryGap="18%"
          style={{ cursor: dragging ? "crosshair" : "pointer" }}
          onMouseDown={(state) => {
            const date = dateAt(state);
            if (date !== null) {
              setDragStart(date);
              setDragCurrent(date);
            }
          }}
          onMouseMove={(state) => {
            setHoverIndex(activeIndexOf(state));
            if (dragStart !== null) {
              const date = dateAt(state);
              if (date !== null) {
                setDragCurrent(date);
              }
            }
          }}
          onMouseUp={commitDrag}
          onMouseLeave={() => {
            setHoverIndex(null);
            commitDrag();
          }}
        >
          <CartesianGrid {...chartGrid(tokens)} />
          <XAxis
            dataKey="date"
            {...chartAxis(tokens)}
            minTickGap={40}
            tickFormatter={formatDayTick}
          />
          <YAxis
            width={56}
            {...chartAxis(tokens)}
            ticks={ticks as number[]}
            domain={[0, ticks[ticks.length - 1] ?? 0]}
            interval={0}
            tickFormatter={(bytes: number) => formatBytes(bytes)}
          />
          <Tooltip
            {...chartTooltipMotion(reduced)}
            cursor={<FluidBandCursor fill={tokens["--hover"]} />}
            content={({ payload }) => {
              const row = tooltipEntry(payload);
              if (row === null) {
                return null;
              }
              const bytes = Number(row["bytes"]);
              const count = Number(row["count"]);
              return (
                <ChartTooltipCard label={formatDay(String(row["date"]))}>
                  <ChartTooltipValue
                    value={formatBytes(bytes)}
                    unit="downloaded"
                  />
                  <ChartTooltipNote>
                    {plural(count, "file", "files")}
                    {peak > 0 && bytes === peak ? " · busiest day" : ""}
                  </ChartTooltipNote>
                </ChartTooltipCard>
              );
            }}
          />
          {band !== null && band.from < band.to ? (
            <ReferenceArea
              x1={band.from}
              x2={band.to}
              {...chartRange(tokens)}
            />
          ) : null}
          <Bar
            dataKey="bytes"
            radius={[3, 3, 0, 0]}
            {...chartAnimation(reduced)}
            fill={seriesColor(tokens)}
            shape={(props: BarShapeProps) => {
              const day = days[props.originalDataIndex];
              return (
                <SeriesBar
                  {...props}
                  tokens={tokens}
                  emphasis={day !== undefined && emphasisOf(day)}
                  dimmed={day !== undefined && dimmedOf(day)}
                  hovered={props.originalDataIndex === hoverIndex}
                />
              );
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * File-kind breakdown. One row per kind that appears, ordered investigative
 * first (executables, archives), each with a bar sized to the busiest kind by
 * bytes and, at the row's end, its file count and total size - size last
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
}: {
  readonly rows: readonly DownloadRow[];
  readonly activeKind: FileKind | null;
  readonly onKind: (kind: FileKind | null) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(listRef, { axis: "y" });
  const shape = useShape();
  const kinds = useMemo(() => {
    const map = new Map<FileKind, { count: number; bytes: number }>();
    for (const row of rows) {
      const entry = map.get(row.kind) ?? { count: 0, bytes: 0 };
      entry.count += 1;
      entry.bytes += row.bytes ?? 0;
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
    return <EmptyRows message="No downloads to classify." />;
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
        aria-label={`${meta.label}: ${formatBytes(bytes)}, ${plural(count, "file", "files")}. ${
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
