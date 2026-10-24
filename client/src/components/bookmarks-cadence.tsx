/**
 * Bookmarks added per calendar month, as Recharts bars on the shared FF chart
 * parts (quiet axes, one hairline grid, the fluid band cursor, bars whose
 * strength springs with hover, the FF tooltip surface). The busiest month is
 * held at full strength, every other month at a lighter step. Recharts'
 * keyboard layer makes the plot focusable, so each month's tooltip is
 * reachable with the arrow keys as well as the pointer.
 */
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type BarShapeProps,
} from "recharts";

import {
  activeIndexOf,
  CHART_FOCUS_CLASS,
  chartAnimation,
  chartAxis,
  chartGrid,
  ChartTooltipCard,
  ChartTooltipNote,
  ChartTooltipValue,
  chartTooltipMotion,
  FluidBandCursor,
  FluidBar,
  tooltipEntry,
  usePrefersReducedMotion,
  type ChartTokens,
} from "./charts.js";

export interface MonthBucket {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly count: number;
}

/** "Dec 2024" label for a `YYYY-MM` month key. */
export function formatMonth(monthKey: string): string {
  const parsed = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return monthKey;
  }
  return parsed.toLocaleDateString("en-GB", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Short "Dec '24" tick for the month axis. */
function formatMonthShort(monthKey: string): string {
  const parsed = new Date(`${monthKey}-01T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return monthKey;
  }
  const month = parsed.toLocaleDateString("en-GB", {
    month: "short",
    timeZone: "UTC",
  });
  return `${month} '${monthKey.slice(2, 4)}`;
}

export function BookmarksCadence({
  months,
  tokens,
}: {
  readonly months: readonly MonthBucket[];
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const peak = months.reduce((max, bucket) => Math.max(max, bucket.count), 0);
  return (
    <ResponsiveContainer
      width="100%"
      height="100%"
      className={CHART_FOCUS_CLASS}
    >
      <BarChart
        data={months as MonthBucket[]}
        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
        barCategoryGap="18%"
        onMouseMove={(state) => {
          setHoverIndex(activeIndexOf(state));
        }}
        onMouseLeave={() => {
          setHoverIndex(null);
        }}
      >
        <CartesianGrid {...chartGrid(tokens)} />
        <XAxis
          dataKey="month"
          {...chartAxis(tokens)}
          minTickGap={32}
          tickFormatter={formatMonthShort}
        />
        <YAxis width={32} {...chartAxis(tokens)} allowDecimals={false} />
        <Tooltip
          {...chartTooltipMotion(reduced)}
          cursor={<FluidBandCursor fill={tokens["--hover"]} />}
          content={({ payload }) => {
            const row = tooltipEntry(payload);
            if (row === null) {
              return null;
            }
            const count = Number(row["count"]);
            return (
              <ChartTooltipCard label={formatMonth(String(row["month"]))}>
                <ChartTooltipValue
                  value={count.toLocaleString("en-US")}
                  unit={count === 1 ? "bookmark saved" : "bookmarks saved"}
                />
                {peak > 0 && count === peak ? (
                  <ChartTooltipNote>Busiest month</ChartTooltipNote>
                ) : null}
              </ChartTooltipCard>
            );
          }}
        />
        <Bar
          dataKey="count"
          radius={[3, 3, 0, 0]}
          {...chartAnimation(reduced)}
          minPointSize={2}
          maxBarSize={48}
          fill={tokens["--primary"]}
          shape={(props: BarShapeProps) => {
            const row = months[props.originalDataIndex];
            const isPeak = row !== undefined && peak > 0 && row.count === peak;
            return (
              <FluidBar
                {...props}
                fill={tokens["--primary"]}
                opacity={isPeak ? 1 : 0.55}
                hovered={props.originalDataIndex === hoverIndex}
              />
            );
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
