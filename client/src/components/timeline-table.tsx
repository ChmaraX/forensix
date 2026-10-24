/**
 * The Timeline page's chronological records panel.
 *
 * The generic FindingsTable unions every wire field across four record kinds
 * into one sparse grid of mostly "absent" cells. This table reads instead:
 * one worded Type column (first), one Time column, one Details column with
 * the field the row is about, and a quiet Commit State word. Every
 * technical field the row carries stays reachable through the row detail
 * sheet.
 *
 * Drawn with FF parts: a page-kit SectionPanel; `CommitStateSplit` keeping
 * saved and recovered (WAL / journal) events in two lists (forensic rule 4)
 * — the timeline route has no Commit State filter, so the loaded stream is
 * split with `splitByCommit`, and each list stays in time order; in its
 * toolbar, an event-type Select ("All types" or one kind, with loaded
 * counts) and Newest/Oldest first as FF Tabs; FF Table with one fluid hover highlight
 * over the rows (each row opens the sheet); the shared loading, error,
 * empty and footer chrome.
 *
 * Presentation rules kept from the evidence tables: states are worded, never
 * color alone; nothing is inferred — an event without its own recorded
 * timestamp shows its state word, not a guessed time.
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

import type { Finding } from "../types.js";
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
import { Switch } from "@/components/ui/switch";
import { TabItem, Tabs, TabsList } from "@/components/ui/tabs";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { FieldCell, StateWord } from "./finding-fields.js";
import { FilterField } from "./filters.js";
import { SecretValueCell, secretFieldsOf } from "./row-sheet.js";
import { ListBlock, type ListSource } from "./list-states.js";
import {
  CommitStateSplit,
  Count,
  SectionPanel,
  splitByCommit,
  TimeCell,
  type CommitView,
} from "./page-kit.js";

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

/** Event-type filter order: the four known kinds. */
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
          <Icon size={size.icon} strokeWidth={1.5} />
        </span>
        {meta?.label ?? kind}
      </span>
    </TableCell>
  );
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

function hasValue(row: Finding, name: string): boolean {
  const field = row.fields[name];
  return field?.state === "value" && field.value !== "";
}

/** The field the row is about, large, with its context below. The primary
 *  field falls back to the secondary one only when it holds no recorded
 *  value; when neither does, the primary field's own state word shows. */
function DetailsCell({
  row,
  reveal,
}: {
  readonly row: Finding;
  readonly reveal: boolean;
}) {
  const size = useSize();
  const meta = EVENT_META[row.findingKind];
  if (meta === undefined) {
    return (
      <TableCell>
        <FieldCell field={undefined} />
      </TableCell>
    );
  }
  const secrets = secretFieldsOf(row);
  const hidden = (name: string) => !reveal && secrets.includes(name);
  const primaryRecorded = hasValue(row, meta.primary);
  const headline =
    primaryRecorded || !hasValue(row, meta.secondary)
      ? meta.primary
      : meta.secondary;
  return (
    <TableCell className="max-w-[460px]">
      <span className="flex min-w-0 flex-col">
        {hidden(headline) ? (
          <SecretValueCell field={row.fields[headline]} reveal={false} />
        ) : (
          <FieldCell
            field={row.fields[headline]}
            format={asText}
            className="text-foreground"
          />
        )}
        {!primaryRecorded ? null : hidden(meta.secondary) ? (
          <span className={size.type.caption}>
            <SecretValueCell
              field={row.fields[meta.secondary]}
              reveal={false}
            />
          </span>
        ) : (
          <FieldCell
            field={row.fields[meta.secondary]}
            format={asText}
            className={cn(size.type.caption, "font-mono text-muted-foreground")}
          />
        )}
      </span>
    </TableCell>
  );
}

function RecordTable({
  rows,
  reveal,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly reveal: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
      <Table className="min-w-[680px]">
        <TableHeader>
          <TableRow>
            {["Type", "Time (UTC)", "Details", "State"].map((label) => (
              <TableHead key={label} className="whitespace-nowrap">
                {label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="reveal-items">
          {rows.map((row, index) => {
            const open = () => {
              onSelect(row);
            };
            return (
              <TableRow
                key={index}
                index={index}
                tabIndex={0}
                aria-label={`Open ${timelineEventLabel(row.findingKind)} row detail`}
                onClick={open}
                onKeyDown={(event) => {
                  activateOnKey(event, open);
                }}
                className={ROW_FOCUS_CLASS}
              >
                <EventCell kind={row.findingKind} />
                <TableCell className="whitespace-nowrap">
                  <TimeCell
                    field={
                      row.fields[EVENT_META[row.findingKind]?.timeField ?? ""]
                    }
                  />
                </TableCell>
                <DetailsCell row={row} reveal={reveal} />
                <TableCell className="whitespace-nowrap">
                  <StateWord state={row.commitState} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** Select can't hold an empty value; this stands for "every event type". */
const ALL_KINDS = "\u0000all";

/** The event-type filter (one type, or all of them), as an FF Select.
 *  Each type carries the count of loaded rows in the list on show. */
function KindSelect({
  counts,
  active,
  onChange,
}: {
  readonly counts: ReadonlyMap<string, number>;
  readonly active: string | null;
  readonly onChange: (kind: string | null) => void;
}) {
  return (
    <FilterField label="Event type" htmlFor="timeline-event-type">
      <Select
        value={active ?? ALL_KINDS}
        onValueChange={(value) => {
          onChange(value === ALL_KINDS ? null : value);
        }}
      >
        <SelectTrigger id="timeline-event-type" className="min-w-[156px]" />
        <SelectContent>
          <SelectItem index={0} value={ALL_KINDS}>
            All types
          </SelectItem>
          {FILTER_KINDS.map((kind, index) => (
            <SelectItem key={kind} index={index + 1} value={kind}>
              {EVENT_META[kind]?.label ?? kind}{" "}
              <Count>{counts.get(kind) ?? 0}</Count>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  );
}

function countKinds(rows: readonly Finding[]): Map<string, number> {
  const byKind = new Map<string, number>();
  for (const row of rows) {
    byKind.set(row.findingKind, (byKind.get(row.findingKind) ?? 0) + 1);
  }
  return byKind;
}

/**
 * The panel. The timeline route has no Commit State or kind parameter, so
 * the loaded stream is split into saved and recovered events on the client
 * and the event-type filter narrows the list on show; the footer states how
 * many of the loaded events are shown, and "Load more" keeps fetching the
 * whole stream underneath. Direction is a real query parameter and is owned
 * by the page.
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
  onClearRange,
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
  readonly onClearRange: () => void;
}) {
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [view, setView] = useState<CommitView>("saved");
  const [reveal, setReveal] = useState(false);
  // "Show values" appears once a loaded row holds a secret (a Payment form
  // value); Payment values stay hidden until it is on.
  const anySecret = useMemo(
    () =>
      rows.some(
        (row) => row.findingKind !== "cookie" && secretFieldsOf(row).length > 0,
      ),
    [rows],
  );

  const split = useMemo(() => splitByCommit(rows), [rows]);
  const inView = view === "saved" ? split.saved : split.recovered;
  const counts = useMemo(() => countKinds(inView), [inView]);
  const firstRead = loading && rows.length === 0;

  const source: ListSource = {
    rows,
    cursor,
    loading,
    error,
    loadMore: onLoadMore,
    retry: onRetry,
  };

  const list = (part: readonly Finding[], recovered: boolean) => {
    const visible =
      kindFilter === null
        ? part
        : part.filter((row) => row.findingKind === kindFilter);
    const noun = recovered ? "recovered events" : "saved events";
    const more = cursor === null ? "" : " Load more to read further.";
    return (
      <ListBlock
        list={source}
        noun={
          recovered
            ? { one: "recovered event", many: "recovered events" }
            : { one: "saved event", many: "saved events" }
        }
        shown={visible.length}
        filtered={kindFilter !== null || rangeActive}
        filteredMessage={`No loaded ${noun} match ${
          kindFilter === null ? "the selected days" : "this event type"
        }.${more}`}
        onClearFilters={() => {
          setKindFilter(null);
          onClearRange();
        }}
        loadingLabel="Loading events"
        skeletonRows={recovered ? 3 : 8}
        errorTitle="The timeline could not be loaded."
        summary={`${visible.length.toLocaleString("en-US")} ${noun} shown of ${rows.length.toLocaleString("en-US")} loaded`}
        empty={
          <EmptyRows
            title={recovered ? "No recovered events" : "No saved events"}
            message={
              recovered
                ? `No loaded event came from a write-ahead log or rollback journal.${more}`
                : `No loaded event came from a saved database.${more}`
            }
          />
        }
      >
        <RecordTable rows={visible} reveal={reveal} onSelect={onSelect} />
      </ListBlock>
    );
  };

  return (
    <SectionPanel
      id="timeline-records-title"
      title="Chronological records"
      description={
        rangeActive
          ? "Filtered to the selected days, in time order."
          : "Every recorded event, in time order."
      }
    >
      <CommitStateSplit
        value={view}
        onValueChange={setView}
        label="Saved or recovered events"
        savedCount={firstRead ? null : split.saved.length}
        recoveredCount={firstRead ? null : split.recovered.length}
        savedMore={cursor !== null}
        recoveredMore={cursor !== null}
        toolbar={
          <>
            {anySecret ? (
              <Switch
                label="Show values"
                checked={reveal}
                onToggle={() => {
                  setReveal((value) => !value);
                }}
                className="mr-2"
              />
            ) : null}
            <KindSelect
              counts={counts}
              active={kindFilter}
              onChange={setKindFilter}
            />
            <Tabs
              value={direction}
              onValueChange={(next) => {
                onDirectionChange(next === "asc" ? "asc" : "desc");
              }}
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
          </>
        }
        saved={list(split.saved, false)}
        recovered={list(split.recovered, true)}
      />
    </SectionPanel>
  );
}
