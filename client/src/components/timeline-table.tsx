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
 * list stays in time order; in its toolbar, the event types as page-kit
 * `CountChips` with their counts in the list on show ("All 65 · Page visit
 * 24 · …"), which give the mix at a glance and filter with one click. The
 * counts are of the events loaded so far: while the stream has more pages
 * the first chip reads "All loaded", so "Page visit 16" never passes for
 * the Case's total; `ResponsiveRows` (a table from `sm`, stacked cards below) with each
 * row opening the sheet; the shared loading, error, empty and footer chrome.
 *
 * Presentation rules kept from the evidence tables: states are worded, never
 * color alone; nothing is inferred — an event without its own recorded
 * timestamp shows its state word, not a guessed time.
 */
import { useMemo, useState } from "react";

import { updateView, useViewFilter, useViewTab } from "../view-state.js";
import { CompactFilters, FilterField, ProfilePicker } from "./filters.js";

import { rowRefOf } from "../router.js";
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
import { FieldCell, StateWord } from "./finding-fields.js";
import { fileNameOf } from "./downloads-model.js";
import { formFieldLabel } from "./form-data.js";
import { SecretValueCell } from "./row-sheet.js";
import { secretFieldsOf } from "./secrets.js";
import { ListBlock, type ListSource } from "./list-states.js";
import {
  CommitStateSplit,
  CountChips,
  SectionPanel,
  splitByCommit,
  TimeCell,
  TypeLabel,
  type CountChip,
} from "./page-kit.js";
import { fieldText } from "../field-readers.js";
import { isCodeLike } from "./field-state.js";
import { ResponsiveRows, type RowColumn } from "./responsive-rows.js";

export type TimelineDirection = "asc" | "desc";

/**
 * What each timeline record kind is, in reading order: its worded label, its
 * icon, the field holding the event's own recorded instant, and the fields
 * that say what the row is about. `primary` always leads with its own state
 * word when it holds no value (a visit with no page title reads "(empty)"
 * over its URL, as History does - forensic rule 3), `secondary` below it.
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

/**
 * The row sheet's title: the name the row records - a visit's page title,
 * a download's file name, a cookie's name, a form entry's field label -
 * else the worded event kind (the sheet then names the kind once).
 */
export function timelineRowTitle(row: Finding): string {
  const text = (name: string) => {
    const value = fieldText(row.fields[name]);
    return value === null || value.trim() === "" ? null : value;
  };
  const named =
    row.findingKind === "history_visit"
      ? text("title")
      : row.findingKind === "download"
        ? fileNameOf(text("targetPath"))
        : row.findingKind === "cookie"
          ? text("name")
          : row.findingKind === "autofill_entry" && text("fieldName") !== null
            ? formFieldLabel(text("fieldName"))
            : null;
  return named ?? timelineEventLabel(row.findingKind);
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

/** The field the row is about, large, with its context below. With no
 *  recorded value the primary field shows its own state word ("(empty)",
 *  "absent"), never borrowing the secondary field's value. */
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
  const headline = meta.primary;
  // A form entry is named by the shared field-name label (the Form data
  // page's rule), never its raw type in mono; the sheet keeps the raw name.
  // A download reads by its file name, as the Downloads table does; the
  // full path is its tooltip and stays whole in the sheet.
  const path =
    row.findingKind === "download" && headline === "targetPath"
      ? fieldText(row.fields.targetPath)
      : null;
  const fieldLabel =
    row.findingKind === "autofill_entry" && headline === "fieldName"
      ? formFieldLabel(fieldText(row.fields.fieldName))
      : path === null
        ? null
        : fileNameOf(path);
  return (
    <span className="flex min-w-0 flex-col">
      {fieldLabel !== null ? (
        <span
          className={cn(size.type.body, "block truncate text-foreground")}
          title={path ?? fieldLabel}
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
      {hidden(meta.secondary) ? (
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

/** An event's stable key: its row reference (a record id, unique across
 *  the four artifacts the stream merges). */
function recordKey(row: Finding): string {
  return rowRefOf(row);
}

function recordLabel(row: Finding): string {
  return `Open ${timelineEventLabel(row.findingKind)} row detail`;
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
      rowKey={recordKey}
      rowLabel={recordLabel}
      onSelect={onSelect}
      tableClassName="min-w-[640px]"
    />
  );
}

/** The event-type chips (page-kit `CountChips`): "All" or one kind, each
 *  with its count in the list on show. A kind with no event there sits out
 *  unless it is the pick. While the stream has more pages (`partial`) the
 *  counts are of loaded events, and the first chip says so: "All loaded". */
function KindChips({
  counts,
  total,
  active,
  onChange,
  partial,
}: {
  readonly counts: ReadonlyMap<string, number>;
  readonly total: number;
  readonly active: string | null;
  readonly onChange: (kind: string | null) => void;
  readonly partial: boolean;
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
      partial={partial}
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
  rangeWords = null,
  profileOptions,
  profiles,
  onProfilesChange,
  profileWords = null,
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
  /** The range in words ("on 12 Mar 2024", "in 11 - 14 Mar"), for an
   *  empty list. */
  readonly rangeWords?: string | null;
  /** Every profile the Case knows, for the picker. */
  readonly profileOptions: readonly string[];
  /** The Case-wide profile pick (empty: every profile). */
  readonly profiles: readonly string[];
  readonly onProfilesChange: (profiles: readonly string[]) => void;
  /** The pick in words ("in Profile 2"), for an empty list. */
  readonly profileWords?: string | null;
}) {
  // The kind chip is in the URL (`filter`), so refresh and Back keep it.
  const [kindFilter, setKindFilter] = useViewFilter();
  // Saved / Recovered lives in the URL (`tab`), so Back and a refresh keep it.
  const [view, setView] = useViewTab();
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
  // One event type on show: "All 2 · Page visit 2" would filter nothing
  // (and an empty "Filters" popover must not appear for it on a phone).
  const showKinds =
    kindFilter !== null ||
    FILTER_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).length > 1;
  const firstRead = loading && rows.length === 0;

  const source: ListSource = {
    rows,
    cursor,
    loading,
    error,
    loadMore: onLoadMore,
    retry: onRetry,
  };

  // Only the tab on show is filtered (and once per change, not per
  // render): the other tab's list is not built until it is picked.
  const visibleInView = useMemo(
    () =>
      kindFilter === null
        ? inView
        : inView.filter((row) => row.findingKind === kindFilter),
    [inView, kindFilter],
  );

  const list = (part: readonly Finding[], recovered: boolean) => {
    const visible = visibleInView;
    const noun = recovered
      ? { one: "recovered event", many: "recovered events" }
      : { one: "saved event", many: "saved events" };
    const more = cursor === null ? "" : " Load more to read further.";
    return (
      <ListBlock
        list={source}
        noun={noun}
        shown={visible.length}
        filtered={kindFilter !== null || rangeActive || profiles.length > 0}
        filteredMessage={
          kindFilter !== null
            ? `No loaded ${noun.many} match this event type.${more}`
            : // The days are a server filter: with the stream read to its
              // end, "none on 2 Mar" is the whole answer.
              `No ${cursor === null ? "" : "loaded "}${noun.many} ${[
                rangeWords ?? (rangeActive ? "in the selected days" : null),
                profileWords,
              ]
                .filter((part) => part !== null)
                .join(" ")}.${more}`
        }
        onClearFilters={() => {
          setKindFilter(null);
          updateView({ from: "", to: "", profiles: [] });
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
            {/* On a phone the profile pick and the event type share the
                one "Filters" popover (two toolbar rows, like History). */}
            <CompactFilters
              active={
                (profiles.length > 0 ? 1 : 0) + (kindFilter === null ? 0 : 1)
              }
            >
              {profileOptions.length > 1 ? (
                <FilterField label="Profiles" htmlFor="timeline-profiles">
                  <ProfilePicker
                    id="timeline-profiles"
                    profiles={profileOptions}
                    selected={profiles}
                    onChange={onProfilesChange}
                  />
                </FilterField>
              ) : null}
              {showKinds ? (
                <KindChips
                  counts={counts}
                  total={inView.length}
                  active={kindFilter}
                  onChange={setKindFilter}
                  partial={cursor !== null}
                />
              ) : null}
            </CompactFilters>
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
        saved={view === "saved" ? list(split.saved, false) : null}
        recovered={view === "recovered" ? list(split.recovered, true) : null}
      />
    </SectionPanel>
  );
}
