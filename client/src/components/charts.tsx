/**
 * Overview charts, drawn with Recharts.
 *
 * Every series here is analyzer output rendered directly: visit counts per day,
 * visit counts per hour, and the Completeness Statement's produced/attempted
 * ratio. Nothing is smoothed into a trend the evidence does not contain, and no
 * axis is projected past the last recorded day.
 *
 * Recharts writes its colours as SVG presentation attributes, and Chrome does
 * not resolve `var()` inside those. The theme tokens are therefore read off
 * `<html>` and passed down as resolved values, re-read whenever `data-theme`
 * changes, so charts follow light and dark without components branching on the
 * mode themselves.
 */
import { useEffect, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface DayCount {
  readonly date: string;
  readonly count: number;
}

const TOKENS = [
  "--primary",
  "--muted-foreground",
  "--border",
  "--card",
  "--foreground",
  "--muted",
  "--success",
] as const;

export type ChartTokens = Readonly<Record<(typeof TOKENS)[number], string>>;

function readTokens(): ChartTokens {
  const styles = getComputedStyle(document.documentElement);
  const entries = TOKENS.map(
    (token) => [token, styles.getPropertyValue(token).trim()] as const,
  );
  return Object.fromEntries(entries) as ChartTokens;
}

/** Resolved theme colours for Recharts, kept in step with `<html data-theme>`. */
export function useChartTokens(): ChartTokens {
  const [tokens, setTokens] = useState<ChartTokens>(readTokens);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setTokens(readTokens());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => {
      observer.disconnect();
    };
  }, []);
  return tokens;
}

/**
 * Recharts animates through JavaScript, so the stylesheet's reduced-motion
 * guard cannot reach it. Charts ask for the preference and switch animation off
 * themselves.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const query = globalThis.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => {
      setReduced(query.matches);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);
  return reduced;
}

function formatDay(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }
  return parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** "12 AM" / "9 PM" style hour label, shared with the Overview's highlight strip. */
export function formatHour(hour: number): string {
  if (hour === 0) {
    return "12 AM";
  }
  if (hour === 12) {
    return "12 PM";
  }
  return hour < 12 ? `${String(hour)} AM` : `${String(hour - 12)} PM`;
}

function EmptyChart({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex h-full min-h-[120px] items-center justify-center text-[13px] text-muted-foreground">
      {children}
    </div>
  );
}

/** Themed replacement for the Recharts default tooltip. */
function ChartTooltip({
  tokens,
  label,
  value,
  unit,
}: {
  readonly tokens: ChartTokens;
  readonly label: string;
  readonly value: number;
  readonly unit: string;
}) {
  return (
    <div
      className="rounded-md border px-3 py-2 text-[12px] shadow-md"
      style={{
        backgroundColor: tokens["--card"],
        borderColor: tokens["--border"],
        color: tokens["--foreground"],
      }}
    >
      <p className="font-medium">{label}</p>
      <p
        className="tabular-nums"
        style={{ color: tokens["--muted-foreground"] }}
      >
        {value.toLocaleString("en-US")} {unit}
      </p>
    </div>
  );
}

/**
 * Recharts types its tooltip payload loosely and differently per chart, so the
 * one datum a tooltip needs is pulled out here behind a single narrow check
 * rather than casting at each call site.
 */
function tooltipEntry(payload: unknown): Record<string, unknown> | null {
  if (!Array.isArray(payload)) {
    return null;
  }
  const first: unknown = payload[0];
  if (typeof first !== "object" || first === null || !("payload" in first)) {
    return null;
  }
  const row = (first as { payload: unknown }).payload;
  return typeof row === "object" && row !== null
    ? (row as Record<string, unknown>)
    : null;
}

/**
 * Visits per recorded day. The area is the hero of the Overview: it is the one
 * series that shows the shape of a session rather than a single figure.
 */
export function ActivityArea({
  days,
  tokens,
}: {
  readonly days: readonly DayCount[];
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  if (days.length === 0) {
    return <EmptyChart>No dated visits to draw.</EmptyChart>;
  }
  const rows = days.map((day) => ({ ...day, label: formatDay(day.date) }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fxActivityFill" x1="0" y1="0" x2="0" y2="1">
            <stop
              offset="0%"
              stopColor={tokens["--primary"]}
              stopOpacity={0.3}
            />
            <stop
              offset="100%"
              stopColor={tokens["--primary"]}
              stopOpacity={0}
            />
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
          width={38}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
        />
        <Tooltip
          cursor={{ stroke: tokens["--border"], strokeWidth: 1 }}
          content={({ payload }) => {
            const row = tooltipEntry(payload);
            return row === null ? null : (
              <ChartTooltip
                tokens={tokens}
                label={String(row["label"])}
                value={Number(row["count"])}
                unit="page visits"
              />
            );
          }}
        />
        <Area
          type="monotone"
          dataKey="count"
          stroke={tokens["--primary"]}
          strokeWidth={2}
          fill="url(#fxActivityFill)"
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

/**
 * Visits by hour of day. Bars carry a rounded cap so the row reads as part of
 * the same soft world as the panels, and the busiest hour is the only one held
 * at full strength.
 */
export function HourBars({
  hours,
  tokens,
}: {
  readonly hours: readonly number[];
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  const total = hours.reduce((sum, count) => sum + count, 0);
  if (total === 0) {
    return <EmptyChart>No timed visits to draw.</EmptyChart>;
  }
  const peak = Math.max(...hours);
  const rows = hours.map((count, hour) => ({
    hour,
    count,
    label: formatHour(hour),
  }));
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid
          vertical={false}
          stroke={tokens["--border"]}
          strokeDasharray="3 3"
        />
        <XAxis
          dataKey="hour"
          tickLine={false}
          axisLine={false}
          interval={5}
          tickFormatter={(hour: number) => formatHour(hour)}
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
          cursor={{ fill: tokens["--muted"], opacity: 0.5 }}
          content={({ payload }) => {
            const row = tooltipEntry(payload);
            return row === null ? null : (
              <ChartTooltip
                tokens={tokens}
                label={String(row["label"])}
                value={Number(row["count"])}
                unit="page visits"
              />
            );
          }}
        />
        <Bar
          dataKey="count"
          radius={[5, 5, 5, 5]}
          isAnimationActive={!reduced}
          animationDuration={650}
        >
          {rows.map((row) => (
            <Cell
              key={row.hour}
              fill={tokens["--primary"]}
              fillOpacity={row.count === peak ? 1 : 0.35}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/**
 * The share of attempted artifacts the analyzer could actually read. The dial
 * is a ratio of two counts the Completeness Statement already reports; the
 * figures stay printed beside it, because a ring alone is not a statement.
 */
export function CoverageDial({
  produced,
  attempted,
  tokens,
}: {
  readonly produced: number;
  readonly attempted: number;
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  if (attempted === 0) {
    return <EmptyChart>Nothing analyzed yet.</EmptyChart>;
  }
  const percent = Math.round((produced / attempted) * 100);
  return (
    <div className="relative h-full w-full">
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          data={[{ name: "readable", value: percent }]}
          innerRadius="72%"
          outerRadius="100%"
          startAngle={90}
          endAngle={-270}
        >
          <PolarAngleAxis
            type="number"
            domain={[0, 100]}
            angleAxisId={0}
            tick={false}
          />
          <RadialBar
            dataKey="value"
            cornerRadius={999}
            background={{ fill: tokens["--muted"] }}
            fill={tokens["--primary"]}
            isAnimationActive={!reduced}
            animationDuration={800}
          />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-[28px] leading-none font-semibold tracking-tight tabular-nums">
          {percent}%
        </span>
        <span className="mt-1 text-[11.5px] text-muted-foreground tabular-nums">
          {produced} of {attempted} readable
        </span>
      </div>
    </div>
  );
}
