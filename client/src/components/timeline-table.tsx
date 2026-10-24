/**
 * The Timeline page's chronological records panel.
 *
 * The generic FindingsTable unions every wire field across four record kinds
 * into one sparse grid of mostly "absent" cells. This table reads instead:
 * one worded Event column (the row's TYPE, first), one Time column, one
 * Details column with the field the row is about, and a quiet Commit State
 * word. Every technical field the row carries stays reachable through the
 * row detail sheet.
 *
 * Drawn with FF parts: a Panel; FF Tabs (segmented) for Newest/Oldest first;
 * FF TabsSubtle for the event-kind filter; FF Table with one fluid hover
 * highlight over the rows (each row opens the sheet); the shared loading,
 * error, empty and footer chrome from list-states / data-table.
 *
 * Presentation rules kept from the evidence tables: states are worded, never
 * color alone; nothing is inferred — an event without its own recorded
 * timestamp shows the word "absent", not a guessed time. This stays one
 * chronological stream: Commit States are never split out of it.
 */
import {
  Activity,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ClipboardList,
  Cookie,
  Download,
  Globe,
  type LucideIcon,
} from "lucide-react";
import { useMemo, useState } from "react";

import type { Finding } from "../types.js";
import { Panel } from "@/components/panel";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import {
  AbsentWord,
  fieldText,
  fieldUtc,
  formatInstant,
  StateWord,
} from "./finding-fields.js";
import { ErrorRows, ListFooter, LoadingRows } from "./list-states.js";

export type TimelineDirection = "asc" | "desc";

/**
 * What each timeline record kind is, in reading order: its worded label, its
 * icon, the field holding the event's own recorded instant, and the fields
 * that say what the row is about. `primary` falls back to `secondary` when
 * the primary field is empty or missing (a visit with no page title shows
 * its URL large rather than an "(empty)" as the headline).
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

/** The worded event label for a timeline record kind (falls back to the
 *  raw kind), e.g. for the row sheet's title. */
export function timelineEventLabel(kind: string): string {
  return EVENT_META[kind]?.label ?? kind;
}

/** Filter order: "All events" first, then the four known kinds. */
const FILTER_KINDS = [
  "history_visit",
  "download",
  "cookie",
  "autofill_entry",
] as const;

function EventCell({ kind }: { readonly kind: string }) {
  const meta = EVENT_META[kind];
  const Icon = meta?.icon ?? Globe;
  const size = useSize();
  return (
    <TableCell className="whitespace-nowrap text-foreground">
      <span className="inline-flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className="inline-flex size-6 shrink-0 items-center justify-center rounded-md bg-hover text-muted-foreground"
        >
          <Icon size={size.icon - 2} strokeWidth={1.5} />
        </span>
        {meta?.label ?? kind}
      </span>
    </TableCell>
  );
}

function TimeCell({ utc }: { readonly utc: string | null }) {
  const parts = utc === null ? null : formatInstant(utc);
  if (utc === null || parts === null) {
    return (
      <TableCell className="whitespace-nowrap">
        <AbsentWord />
      </TableCell>
    );
  }
  return (
    <TableCell
      className="whitespace-nowrap tabular-nums"
      title={`${utc} (UTC)`}
    >
      <span>{parts.date}</span>
      <span className="ml-2 text-muted-foreground">{parts.time}</span>
    </TableCell>
  );
}

function DetailsCell({ row }: { readonly row: Finding }) {
  const size = useSize();
  const meta = EVENT_META[row.findingKind];
  if (meta === undefined) {
    return (
      <TableCell>
        <AbsentWord />
      </TableCell>
    );
  }
  const primary = fieldText(row.fields[meta.primary]);
  const secondary = fieldText(row.fields[meta.secondary]);
  const headline = primary ?? secondary;
  const subline = primary === null ? null : secondary;
  return (
    <TableCell className="max-w-[460px]">
      {headline === null ? (
        <AbsentWord />
      ) : (
        <span className="flex min-w-0 flex-col">
          <span className="truncate" title={headline}>
            {headline}
          </span>
          {subline === null || subline === headline ? null : (
            <span
              className={cn(
                size.type.caption,
                "truncate font-mono text-muted-foreground",
              )}
              title={subline}
            >
              {subline}
            </span>
          )}
        </span>
      )}
    </TableCell>
  );
}

/**
 * The panel. The event filter narrows the rows already loaded from the
 * timeline route — the route itself has no kind parameter — so the footer
 * states "of N loaded" whenever a filter hides rows, and "Load more" keeps
 * fetching the unfiltered stream underneath. Direction is a real query
 * parameter and is owned by the page.
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
  const size = useSize();
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

  const filterIndex =
    kindFilter === null
      ? 0
      : FILTER_KINDS.indexOf(kindFilter as (typeof FILTER_KINDS)[number]) + 1;

  return (
    <Panel className="overflow-clip">
      <SizeProvider size="compact">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 pt-3.5 pb-2">
          <div className="flex min-w-0 flex-col">
            <h2
              className={cn(size.type.subtitle, "text-foreground")}
              style={{ fontVariationSettings: fontWeights.semibold }}
            >
              Chronological records
            </h2>
            <p className={cn(size.type.caption, "text-muted-foreground")}>
              {rangeActive
                ? "Filtered to the selected days."
                : "Every recorded event in one stream."}
            </p>
          </div>
          <Tabs
            value={direction}
            onValueChange={(next) => {
              onDirectionChange(next as TimelineDirection);
            }}
            className="ml-auto"
          >
            <TabsList aria-label="Order">
              <TabItem
                value="desc"
                icon={ArrowDownWideNarrow}
                label="Newest first"
              />
              <TabItem
                value="asc"
                icon={ArrowUpNarrowWide}
                label="Oldest first"
              />
            </TabsList>
          </Tabs>
        </header>

        <div className="scroll-fade-x overflow-x-auto border-b border-border px-3 pb-2">
          <TabsSubtle
            selectedIndex={filterIndex}
            onSelect={(index) => {
              setKindFilter(
                index === 0 ? null : (FILTER_KINDS[index - 1] ?? null),
              );
            }}
            aria-label="Event kind"
            className="w-max"
          >
            <TabsSubtleItem
              index={0}
              icon={Activity}
              label={`All events ${String(rows.length)}`}
            />
            {FILTER_KINDS.map((kind, index) => (
              <TabsSubtleItem
                key={kind}
                index={index + 1}
                icon={EVENT_META[kind]?.icon}
                label={`${EVENT_META[kind]?.label ?? kind} ${String(counts.get(kind) ?? 0)}`}
              />
            ))}
          </TabsSubtle>
        </div>
      </SizeProvider>

      {error !== null ? (
        <ErrorRows message={error} onRetry={onRetry} />
      ) : loading && rows.length === 0 ? (
        <LoadingRows rows={6} />
      ) : visible.length === 0 ? (
        <EmptyRows
          message={
            kindFilter === null
              ? "No recorded events for this range."
              : "No loaded events of this kind. Load more rows or clear the filter."
          }
        />
      ) : (
        <div className="scroll-fade-x overflow-x-auto px-2 py-1 [&_tbody>tr:last-child]:border-transparent">
          <Table>
            <TableHeader>
              <TableRow>
                {["Event", "Time (UTC)", "Details", "State"].map((label) => (
                  <TableHead key={label} className="whitespace-nowrap">
                    {label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((row, index) => {
                const open = () => {
                  onSelect(row);
                };
                return (
                  <TableRow
                    key={index}
                    index={index}
                    tabIndex={0}
                    aria-label={`Open ${row.findingKind} row detail`}
                    onClick={open}
                    onKeyDown={(event) => {
                      activateOnKey(event, open);
                    }}
                    className={ROW_FOCUS_CLASS}
                  >
                    <EventCell kind={row.findingKind} />
                    <TimeCell
                      utc={fieldUtc(
                        row.fields[
                          EVENT_META[row.findingKind]?.timeField ?? ""
                        ],
                      )}
                    />
                    <DetailsCell row={row} />
                    <TableCell className="whitespace-nowrap">
                      <StateWord state={row.commitState} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <ListFooter
        count={rows.length}
        cursor={cursor}
        loading={loading}
        onLoadMore={onLoadMore}
        summary={
          kindFilter === null
            ? undefined
            : `${String(visible.length)} of ${String(rows.length)} loaded rows shown`
        }
      />
    </Panel>
  );
}
