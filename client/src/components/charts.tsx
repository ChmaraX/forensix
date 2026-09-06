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
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
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
 * Visits per recorded day, as discrete bars — the one activity chart shared
 * by Overview and History so the same dataset never reads two different ways
 * in the same app. Each day is one recorded bucket, not a sample on a
 * continuous curve: bars are the honest reading here, an interpolated area
 * would imply a continuity between days the evidence doesn't contain. The
 * busiest day is held at full strength; every other day sits at reduced
 * opacity, so the peak reads at a glance without a second legend.
 */
export function ActivityBars({
  days,
  tokens,
  selectedDate = null,
  onSelectDay,
}: {
  readonly days: readonly DayCount[];
  readonly tokens: ChartTokens;
  /** The one day currently filtered to, if any — drawn with an outline
   *  distinct from the busiest-day fill so "selected" and "peak" never read
   *  as the same signal. */
  readonly selectedDate?: string | null;
  /** Present only where a click can act on it (e.g. History); omitted, the
   *  chart stays the plain read-only reading it always was (e.g. Overview). */
  readonly onSelectDay?: (date: string) => void;
}) {
  const reduced = usePrefersReducedMotion();
  if (days.length === 0) {
    return <EmptyChart>No dated visits to draw.</EmptyChart>;
  }
  const rows = days.map((day) => ({ ...day, label: formatDay(day.date) }));
  const peak = rows.reduce((max, row) => Math.max(max, row.count), 0);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
          radius={[3, 3, 0, 0]}
          isAnimationActive={!reduced}
          animationDuration={600}
          minPointSize={2}
        >
          {rows.map((row) => (
            <Cell
              key={row.date}
              fill={tokens["--primary"]}
              fillOpacity={peak > 0 && row.count === peak ? 1 : 0.55}
              stroke={
                row.date === selectedDate ? tokens["--foreground"] : undefined
              }
              strokeWidth={row.date === selectedDate ? 1.5 : 0}
              onClick={
                onSelectDay === undefined
                  ? undefined
                  : () => {
                      onSelectDay(row.date);
                    }
              }
              style={{
                cursor: onSelectDay === undefined ? undefined : "pointer",
              }}
            />
          ))}
        </Bar>
      </BarChart>
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

/** One credential plotted on the saved-login age chart: age since created
 *  (x, days) against dormancy since last used (y, days). Both are derived
 *  from recorded timestamps — never invented; a credential with no recorded
 *  last-use is dropped from the plot, not placed at zero. */
export interface CredentialAgePoint {
  readonly site: string;
  readonly username: string;
  /** Whole days between the recorded creation instant and now. */
  readonly ageDays: number;
  /** Whole days between the recorded last-use instant and now. */
  readonly idleDays: number;
  /** Recorded `timesUsed`, sizing the dot; `null` when the column was absent. */
  readonly timesUsed: number | null;
  /** True when the row was recovered from a sidecar, not committed storage. */
  readonly recovered: boolean;
}

/**
 * Saved-login age scatter. Each dot is one credential: how long ago Chrome
 * first stored it (x) against how long since it was last used (y). Dots near
 * the diagonal were saved and then left; dots low on the y-axis are recently
 * used regardless of age. Every coordinate is read straight off the recorded
 * `dateCreated` / `dateLastUsed` instants — the chart derives distances in
 * days, it does not model or predict anything the evidence does not contain.
 */
export function CredentialAgeScatter({
  points,
  tokens,
}: {
  readonly points: readonly CredentialAgePoint[];
  readonly tokens: ChartTokens;
}) {
  const reduced = usePrefersReducedMotion();
  if (points.length === 0) {
    return <EmptyChart>No dated logins to plot.</EmptyChart>;
  }
  const committed = points.filter((point) => !point.recovered);
  const recovered = points.filter((point) => point.recovered);
  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 10, right: 12, bottom: 20, left: 4 }}>
        <CartesianGrid stroke={tokens["--border"]} strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="ageDays"
          name="Age"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${String(value)}d`}
          tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
          label={{
            value: "Days since first saved",
            position: "bottom",
            offset: 4,
            fill: tokens["--muted-foreground"],
            fontSize: 11,
          }}
        />
        <YAxis
          type="number"
          dataKey="idleDays"
          name="Idle"
          width={44}
          tickLine={false}
          axisLine={false}
          tickFormatter={(value: number) => `${String(value)}d`}
          tick={{ fill: tokens["--muted-foreground"], fontSize: 11 }}
          label={{
            value: "Days idle",
            angle: -90,
            position: "insideLeft",
            fill: tokens["--muted-foreground"],
            fontSize: 11,
          }}
        />
        <ZAxis type="number" dataKey="timesUsed" range={[40, 320]} name="Uses" />
        <Tooltip
          cursor={{ stroke: tokens["--border"], strokeWidth: 1 }}
          content={({ payload }) => {
            const row = tooltipEntry(payload);
            if (row === null) {
              return null;
            }
            const uses = row["timesUsed"];
            return (
              <div
                className="rounded-md border px-3 py-2 text-[12px] shadow-md"
                style={{
                  backgroundColor: tokens["--card"],
                  borderColor: tokens["--border"],
                  color: tokens["--foreground"],
                }}
              >
                <p className="font-medium">{String(row["site"])}</p>
                <p style={{ color: tokens["--muted-foreground"] }}>
                  {String(row["username"])}
                </p>
                <p className="tabular-nums" style={{ color: tokens["--muted-foreground"] }}>
                  saved {String(row["ageDays"])}d ago · idle {String(row["idleDays"])}d
                  {typeof uses === "number" ? ` · used ${String(uses)}×` : ""}
                </p>
              </div>
            );
          }}
        />
        <Scatter
          data={committed}
          fill={tokens["--primary"]}
          fillOpacity={0.75}
          isAnimationActive={!reduced}
          animationDuration={650}
        />
        <Scatter
          data={recovered}
          fill={tokens["--muted-foreground"]}
          fillOpacity={0.55}
          shape="diamond"
          isAnimationActive={!reduced}
          animationDuration={650}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
