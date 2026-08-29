/**
 * The Timeline page's chronological records card.
 *
 * The generic FindingsTable unions every wire field across four record kinds
 * into one sparse grid of mostly "absent" cells. This table reads instead:
 * one Time column, one worded Event column, one Details column with the
 * field the row is about, and a quiet Commit State word. Every technical
 * field the row carries stays reachable through the row detail sheet.
 *
 * Presentation rules kept from the evidence tables: states are worded, never
 * color alone; nothing is inferred — an event without its own recorded
 * timestamp shows the word "absent", not a guessed time.
 */
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ClipboardList,
  Cookie,
  Download,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import { cn } from "../lib.js";
import type { Finding } from "../types.js";
import { EmptyRows } from "./data-table.js";
import {
  AbsentWord,
  fieldText,
  fieldUtc,
  formatInstant,
  StateWord,
} from "./finding-fields.js";
import { Button } from "./ui/button.js";
import { Skeleton } from "./ui/misc.js";

export type TimelineDirection = "asc" | "desc";

/**
 * What each timeline record kind is, in reading order: its worded label, its
 * icon, the field holding the event's own recorded instant, and the fields
 * that say what the row is about. `primary` falls back to `secondary` when
 * the primary field is empty or missing (a visit with no page title shows
 * its URL large rather than an italic "(empty)" as the headline).
 */
const EVENT_META: Readonly<
  Record<
    string,
    {
      readonly label: string;
      readonly icon: LucideIcon;
      readonly timeField: string;
      readonly primary: string;
      readonly secondary: string;
    }
  >
> = {
  history_visit: {
    label: "Page visit",
    icon: Globe,
    timeField: "visitTime",
    primary: "title",
    secondary: "url",
  },
  download: {
    label: "Download",
    icon: Download,
    timeField: "startTime",
    primary: "targetPath",
    secondary: "tabUrl",
  },
  cookie: {
    label: "Cookie set",
    icon: Cookie,
    timeField: "creationTime",
    primary: "name",
    secondary: "hostKey",
  },
  autofill_entry: {
    label: "Form entry",
    icon: ClipboardList,
    timeField: "dateCreated",
    primary: "fieldName",
    secondary: "fieldValue",
  },
};

/** Chip order for the event filter; "all" first, then the four known kinds. */
const FILTER_KINDS = [
  "history_visit",
  "download",
  "cookie",
  "autofill_entry",
] as const;

function TimeCell({ utc }: { readonly utc: string | null }) {
  const parts = utc === null ? null : formatInstant(utc);
  if (utc === null || parts === null) {
    return (
      <td className="px-3 py-2.5 whitespace-nowrap">
        <AbsentWord />
      </td>
    );
  }
  return (
    <td
      className="px-3 py-2.5 whitespace-nowrap tabular-nums"
      title={`${utc} (UTC)`}
    >
      <span className="text-[12.5px] font-medium">{parts.date}</span>
      <span className="ml-2 text-[12px] text-muted-foreground">
        {parts.time}
      </span>
    </td>
  );
}

function EventCell({ kind }: { readonly kind: string }) {
  const meta = EVENT_META[kind];
  const Icon = meta?.icon ?? Globe;
  return (
    <td className="px-3 py-2.5 whitespace-nowrap">
      <span className="inline-flex items-center gap-2 text-[12.5px] font-medium">
        <span className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon aria-hidden="true" className="size-3.5 text-foreground/60" />
        </span>
        {meta?.label ?? kind}
      </span>
    </td>
  );
}

function DetailsCell({ row }: { readonly row: Finding }) {
  const meta = EVENT_META[row.findingKind];
  if (meta === undefined) {
    return (
      <td className="px-3 py-2.5">
        <AbsentWord />
      </td>
    );
  }
  const primary = fieldText(row.fields[meta.primary]);
  const secondary = fieldText(row.fields[meta.secondary]);
  const headline = primary ?? secondary;
  const subline = primary === null ? null : secondary;
  return (
    <td className="max-w-[440px] px-3 py-2.5">
      {headline === null ? (
        <AbsentWord />
      ) : (
        <span className="flex min-w-0 flex-col">
          <span
            className="truncate text-[13px] text-foreground/90"
            title={headline}
          >
            {headline}
          </span>
          {subline === null || subline === headline ? null : (
            <span
              className="truncate font-mono text-[11.5px] text-muted-foreground"
              title={subline}
            >
              {subline}
            </span>
          )}
        </span>
      )}
    </td>
  );
}

function StateCell({ state }: { readonly state: Finding["commitState"] }) {
  return (
    <td className="px-3 py-2.5 whitespace-nowrap">
      <StateWord state={state} />
    </td>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  readonly label: string;
  readonly count: number | null;
  readonly active: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150",
        active
          ? "border-accent-border bg-accent text-accent-foreground"
          : "border-border bg-card text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
      {count === null ? null : (
        <span
          className={cn(
            "tabular-nums",
            active ? "opacity-70" : "text-muted-foreground/70",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}

/**
 * The card. The event chips filter the rows already loaded from the timeline
 * route — the route itself has no kind parameter — so the footer states "of
 * N loaded" whenever a chip hides rows, and "Load more" keeps fetching the
 * unfiltered stream underneath. Direction is a real query parameter and is
 * owned by the page.
 */
export function TimelineRecordsCard({
  rows,
  loading,
  error,
  cursor,
  onLoadMore,
  onRetry,
  onSelect,
  direction,
  onDirectionChange,
  rangeActive,
}: {
  readonly rows: readonly Finding[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly cursor: string | null;
  readonly onLoadMore: () => void;
  readonly onRetry: () => void;
  readonly onSelect: (row: Finding) => void;
  readonly direction: TimelineDirection;
  readonly onDirectionChange: (direction: TimelineDirection) => void;
  readonly rangeActive: boolean;
}) {
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  const counts = useMemo(() => {
    const byKind = new Map<string, number>();
    for (const row of rows) {
      byKind.set(row.findingKind, (byKind.get(row.findingKind) ?? 0) + 1);
    }
    return byKind;
  }, [rows]);

  const visible = useMemo(
    () =>
      kindFilter === null
        ? rows
        : rows.filter((row) => row.findingKind === kindFilter),
    [rows, kindFilter],
  );

  const DirectionIcon =
    direction === "desc" ? ArrowDownWideNarrow : ArrowUpNarrowWide;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">Chronological records</h2>
        {rangeActive ? (
          <span className="text-[12px] text-muted-foreground">
            filtered to the selected days
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => {
            onDirectionChange(direction === "desc" ? "asc" : "desc");
          }}
          className="ml-auto inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-2.5 text-[12px] font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <DirectionIcon aria-hidden="true" className="size-3.5" />
          {direction === "desc" ? "Newest first" : "Oldest first"}
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 px-4 py-2.5">
        <FilterChip
          label="All events"
          count={rows.length}
          active={kindFilter === null}
          onClick={() => {
            setKindFilter(null);
          }}
        />
        {FILTER_KINDS.map((kind) => (
          <FilterChip
            key={kind}
            label={EVENT_META[kind]?.label ?? kind}
            count={counts.get(kind) ?? 0}
            active={kindFilter === kind}
            onClick={() => {
              setKindFilter(kindFilter === kind ? null : kind);
            }}
          />
        ))}
      </div>

      {error !== null ? (
        <div
          role="alert"
          className="mx-4 my-4 flex items-start gap-2.5 rounded-md border border-destructive-border bg-destructive-wash px-3.5 py-3"
        >
          <div className="flex-1">
            <p className="text-[13px] font-medium text-destructive">
              The rows could not be loaded.
            </p>
            <p className="text-[12.5px] text-destructive/80">{error}</p>
          </div>
          <Button onClick={onRetry} size="sm" className="shrink-0">
            Retry
          </Button>
        </div>
      ) : loading && rows.length === 0 ? (
        <div className="flex flex-col gap-2 px-4 py-4" aria-label="Loading rows">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-7 w-full" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyRows
          message={
            kindFilter === null
              ? "No recorded events for this range."
              : "No loaded events of this kind. Load more rows or clear the filter."
          }
        />
      ) : (
        <div className="fx-scroll-x">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr>
                {["Time", "Event", "Details", "State"].map((label) => (
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
              {visible.map((row, index) => (
                <tr
                  key={index}
                  tabIndex={0}
                  aria-label={`Open ${row.findingKind} row detail`}
                  onClick={() => {
                    onSelect(row);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(row);
                    }
                  }}
                  className="cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-accent/40"
                >
                  <TimeCell utc={fieldUtc(row.fields[EVENT_META[row.findingKind]?.timeField ?? ""])} />
                  <EventCell kind={row.findingKind} />
                  <DetailsCell row={row} />
                  <StateCell state={row.commitState} />
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 && cursor === null ? null : (
        <div className="flex items-center gap-3 border-t border-border/70 px-4 py-2.5">
          <p
            className="text-[12.5px] text-muted-foreground tabular-nums"
            aria-live="polite"
          >
            {kindFilter === null
              ? `${String(rows.length)} row${rows.length === 1 ? "" : "s"} shown`
              : `${String(visible.length)} of ${String(rows.length)} loaded rows shown`}
            {cursor === null ? "" : " · more available"}
          </p>
          {cursor !== null ? (
            <Button onClick={onLoadMore} disabled={loading} size="sm">
              {loading ? "Loading…" : "Load more"}
            </Button>
          ) : null}
        </div>
      )}
    </section>
  );
}
