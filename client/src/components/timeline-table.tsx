/**
 * The Timeline page's chronological records panel.
 *
 * The generic FindingsTable unions every wire field across four record kinds
 * into one sparse grid of mostly "absent" cells. This table reads instead:
 * one worded Type column (first), one Time column, one Details column with
 * the field the row is about, and — in the Recovered list only — the Commit
 * State word (every saved row would say "saved"). Every technical field the
 * row carries stays reachable through the row detail sheet.
 *
 * Drawn with FF parts: a page-kit SectionPanel with Newest/Oldest first in
 * its header; `CommitStateSplit` keeping saved and recovered (WAL / journal)
 * events in two lists (forensic rule 4) — the timeline route has no Commit
 * State filter, so the loaded stream is split with `splitByCommit`, and each
 * list stays in time order; in its toolbar, the event types as FF
 * TabsSubtle chips with their counts in the list on show ("All events 65 ·
 * Page visit 24 · …"), which give the mix at a glance and filter with one
 * click; `ResponsiveRows` (a table from `sm`, stacked cards below) with each
 * row opening the sheet; the shared loading, error, empty and footer chrome.
 *
 * Presentation rules kept from the evidence tables: states are worded, never
 * color alone; nothing is inferred — an event without its own recorded
 * timestamp shows its state word, not a guessed time.
 */
import { useMemo, useState } from "react";

import type { Finding } from "../types.js";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  ARTIFACT_ICONS,
  SortNewestIcon,
  SortOldestIcon,
  type AppIcon,
} from "@/lib/app-icons";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { EmptyRows } from "./data-table.js";
import {
  FieldCell,
  fieldText,
  isCodeLike,
  StateWord,
} from "./finding-fields.js";
import { formFieldLabel } from "./form-data.js";
import { SecretValueCell, secretFieldsOf } from "./row-sheet.js";
import { ListBlock, type ListSource } from "./list-states.js";
import {
  CommitStateSplit,
  CountChips,
  ResponsiveRows,
  SectionPanel,
  splitByCommit,
  TimeCell,
  TypeLabel,
  type CommitView,
  type CountChip,
  type RowColumn,
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
      readonly icon: AppIcon;
      readonly timeField: string;
      readonly primary: string;
      readonly secondary: string;
    }
  >
> = {
  history_visit: {
    label: "Page visit",
    icon: ARTIFACT_ICONS.history,
    timeField: "visitTime",
    primary: "title",
    secondary: "url",
  },
  download: {
    label: "Download",
    icon: ARTIFACT_ICONS.downloads,
    timeField: "startTime",
    primary: "targetPath",
    secondary: "tabUrl",
  },
  cookie: {
    label: "Cookie set",
    icon: ARTIFACT_ICONS.cookies,
    timeField: "creationTime",
    primary: "name",
    secondary: "hostKey",
  },
  autofill_entry: {
    label: "Form entry",
    icon: ARTIFACT_ICONS.autofill,
    // The instant the timeline orders form entries by (core's
    // queryTimeline sorts them on last use), so the list reads in order.
    timeField: "dateLastUsed",
    primary: "fieldName",
    secondary: "fieldValue",
  },
};

/** The worded event label for a timeline record kind (falls back to the
 *  raw kind), e.g. for the row sheet's title. */
export function timelineEventLabel(kind: string): string {
  return EVENT_META[kind]?.label ?? kind;
}

/** Event-type chip order: the four known kinds. */
const FILTER_KINDS = [
  "history_visit",
  "download",
  "cookie",
  "autofill_entry",
] as const;

function EventType({ kind }: { readonly kind: string }) {
  const meta = EVENT_META[kind];
  return (
    <TypeLabel
      icon={meta?.icon ?? ARTIFACT_ICONS.timeline}
      label={meta?.label ?? kind}
    />
  );
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/** Fields that are always code-like: URLs, paths and cookie names. Any
 *  other value is monospace only when it reads as code (`isCodeLike`);
 *  names, hosts, field labels and typed text stay proportional. */
const MONO_FIELDS: ReadonlySet<string> = new Set([
  "url",
  "tabUrl",
  "targetPath",
  "name",
]);

function monoOf(row: Finding, name: string): boolean {
  return MONO_FIELDS.has(name) || isCodeLike(fieldText(row.fields[name]) ?? "");
}

function hasValue(row: Finding, name: string): boolean {
  const field = row.fields[name];
  return field?.state === "value" && field.value !== "";
}

/** The field the row is about, large, with its context below. The primary
 *  field falls back to the secondary one only when it holds no recorded
 *  value; when neither does, the primary field's own state word shows. */
function Details({
  row,
  reveal,
}: {
  readonly row: Finding;
  readonly reveal: boolean;
}) {
  const size = useSize();
  const meta = EVENT_META[row.findingKind];
  if (meta === undefined) {
    return <FieldCell field={undefined} />;
  }
  const secrets = secretFieldsOf(row);
  const hidden = (name: string) => !reveal && secrets.includes(name);
  const primaryRecorded = hasValue(row, meta.primary);
  const headline =
    primaryRecorded || !hasValue(row, meta.secondary)
      ? meta.primary
      : meta.secondary;
  // A form entry is named by the shared field-name label (the Form data
  // page's rule), never its raw type in mono; the sheet keeps the raw name.
  const fieldLabel =
    row.findingKind === "autofill_entry" && headline === "fieldName"
      ? formFieldLabel(fieldText(row.fields.fieldName))
      : null;
  return (
    <span className="flex min-w-0 flex-col">
      {fieldLabel !== null ? (
        <span
          className={cn(size.type.body, "block truncate text-foreground")}
          title={fieldLabel}
        >
          {fieldLabel}
        </span>
      ) : hidden(headline) ? (
        <SecretValueCell field={row.fields[headline]} reveal={false} />
      ) : (
        <FieldCell
          field={row.fields[headline]}
          format={asText}
          mono={monoOf(row, headline)}
          className="text-foreground"
        />
      )}
      {!primaryRecorded ? null : hidden(meta.secondary) ? (
        <span className={size.type.caption}>
          <SecretValueCell field={row.fields[meta.secondary]} reveal={false} />
        </span>
      ) : (
        <FieldCell
          field={row.fields[meta.secondary]}
          format={asText}
          mono={monoOf(row, meta.secondary)}
          className={cn(size.type.caption, "text-muted-foreground")}
        />
      )}
    </span>
  );
}

/** The record columns. On a phone the card reads Type and (saved) time on
 *  its first line, or Type and the State word (recovered) with the time
 *  under the details. */
function recordColumns(
  recovered: boolean,
  reveal: boolean,
): readonly RowColumn<Finding>[] {
  const columns: RowColumn<Finding>[] = [
    {
      key: "type",
      header: "Type",
      // Fixed widths on the short columns: Details takes the rest, so a
      // range or an event-type pick never shifts the columns.
      className: "w-[168px] whitespace-nowrap",
      stack: "lead",
      cell: (row) => <EventType kind={row.findingKind} />,
      stackedCell: (row) => timelineEventLabel(row.findingKind),
    },
    {
      key: "time",
      header: "Time (UTC)",
      className: "w-[184px] whitespace-nowrap",
      stack: recovered ? "meta" : "aside",
      cell: (row) => (
        <TimeCell
          field={row.fields[EVENT_META[row.findingKind]?.timeField ?? ""]}
        />
      ),
    },
    {
      key: "details",
      header: "Details",
      className: "max-w-[460px]",
      stack: "title",
      cell: (row) => <Details row={row} reveal={reveal} />,
    },
  ];
  if (recovered) {
    columns.push({
      key: "state",
      header: "State",
      className: "w-[184px] whitespace-nowrap",
      stack: "aside",
      cell: (row) => <StateWord state={row.commitState} />,
    });
  }
  return columns;
}

function RecordTable({
  rows,
  recovered,
  reveal,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly recovered: boolean;
  readonly reveal: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  const columns = useMemo(
    () => recordColumns(recovered, reveal),
    [recovered, reveal],
  );
  return (
    <ResponsiveRows
      rows={rows}
      columns={columns}
      rowKey={(row, index) => `${row.commitState}-${String(index)}`}
      rowLabel={(row) =>
        `Open ${timelineEventLabel(row.findingKind)} row detail`
      }
      onSelect={onSelect}
      tableClassName="min-w-[640px]"
    />
  );
}

/** The event-type chips (page-kit `CountChips`): "All" or one kind, each
 *  with its count in the list on show. A kind with no event there sits out
 *  unless it is the pick. */
function KindChips({
  counts,
  total,
  active,
  onChange,
}: {
  readonly counts: ReadonlyMap<string, number>;
  readonly total: number;
  readonly active: string | null;
  readonly onChange: (kind: string | null) => void;
}) {
  const chips = FILTER_KINDS.filter(
    (kind) => (counts.get(kind) ?? 0) > 0 || kind === active,
  ).map(
    (kind): CountChip => ({
      key: kind,
      label: timelineEventLabel(kind),
      count: counts.get(kind) ?? 0,
    }),
  );
  // One event type on show: "All 2 · Page visit 2" would filter nothing.
  if (chips.length < 2 && active === null) {
    return null;
  }
  return (
    <CountChips
      label="Event type"
      total={total}
      chips={chips}
      active={active}
      onChange={onChange}
    />
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
 * and the event-type chips narrow the list on show; while a chip narrows it
 * the footer reads "12 of 65", and "Load more" keeps fetching the whole
 * stream underneath. Direction is a real query parameter and is owned by
 * the page.
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
  const loadedSecret = useMemo(
    () =>
      rows.some(
        (row) => row.findingKind !== "cookie" && secretFieldsOf(row).length > 0,
      ),
    [rows],
  );
  // Once shown, the switch keeps its slot: a range without a Payment row
  // must not pull it out of the toolbar (and reflow the chips beside it).
  const [anySecret, setAnySecret] = useState(false);
  if (loadedSecret && !anySecret) {
    setAnySecret(true);
  }

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
    const noun = recovered
      ? { one: "recovered event", many: "recovered events" }
      : { one: "saved event", many: "saved events" };
    const more = cursor === null ? "" : " Load more to read further.";
    return (
      <ListBlock
        list={source}
        noun={noun}
        shown={visible.length}
        filtered={kindFilter !== null || rangeActive}
        filteredMessage={`No loaded ${noun.many} match ${
          kindFilter === null ? "the selected days" : "this event type"
        }.${more}`}
        onClearFilters={() => {
          setKindFilter(null);
          onClearRange();
        }}
        loadingLabel="Loading events"
        skeletonRows={recovered ? 3 : 8}
        errorTitle="The timeline could not be loaded."
        // The list is one part of the loaded stream: count against that
        // part, never against every loaded event.
        total={part.length}
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
        <RecordTable
          rows={visible}
          recovered={recovered}
          reveal={reveal}
          onSelect={onSelect}
        />
      </ListBlock>
    );
  };

  const newest = direction === "desc";

  return (
    <SectionPanel
      id="timeline-records-title"
      title="Chronological records"
      aside={
        <Button
          variant="ghost"
          leadingIcon={newest ? SortNewestIcon : SortOldestIcon}
          className="ml-auto"
          aria-label={`${newest ? "Newest" : "Oldest"} first. Switch to ${newest ? "oldest" : "newest"} first`}
          onClick={() => {
            onDirectionChange(newest ? "asc" : "desc");
          }}
        >
          {newest ? "Newest first" : "Oldest first"}
        </Button>
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
            <KindChips
              counts={counts}
              total={inView.length}
              active={kindFilter}
              onChange={setKindFilter}
            />
            {anySecret ? (
              <Switch
                label="Show values"
                checked={reveal}
                onToggle={() => {
                  setReveal((value) => !value);
                }}
              />
            ) : null}
          </>
        }
        saved={list(split.saved, false)}
        recovered={list(split.recovered, true)}
      />
    </SectionPanel>
  );
}
