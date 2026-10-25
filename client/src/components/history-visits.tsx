/**
 * History's visit lists: one per Commit State (Saved, Recovered), each a
 * `ListBlock` around a `ResponsiveRows` table. Curated columns: Time, Page
 * (title over URL, its host linked to Sites), Arrived via (the worded
 * transition), Dwell (recorded `visitDuration`, "not recorded" when Chrome
 * kept none - never zero) and, in the Recovered list only, the Commit
 * State word. Every wire field stays reachable through the row sheet.
 */
import { useMemo } from "react";

import { SizeProvider } from "@/lib/size-context";

import { rowRefOf } from "../router.js";
import type { FieldState, Finding } from "../types.js";
import type { PaginatedList } from "../use-commit-state-lists.js";
import { EmptyRows } from "./data-table.js";
import {
  FieldCell,
  fieldString,
  fieldText,
  hostOf,
  SiteAvatar,
  StateWord,
  TwoLineCell,
} from "./finding-fields.js";
import {
  filteredEmptyMessage,
  TRANSITION_LABELS,
  type VisitFilters,
} from "./history-filters.js";
import { UrlWithSiteLink } from "./host-link.js";
import { ListBlock } from "./list-states.js";
import { ResponsiveRows, TimeCell, type RowColumn } from "./page-kit.js";
import { Term } from "./term.js";

/**
 * A recorded `visitDuration` (microseconds, as a string or number field)
 * read as a compact human dwell — "4m 12s", "38s", "0s", "2h 05m". Returns
 * null for anything that is not a non-negative number (an (empty) or
 * non-numeric value): the caller then shows the field as recorded, its own
 * word or its raw value, never "not recorded" over a recorded value.
 */
function formatDwell(field: FieldState | undefined): string | null {
  const raw = fieldString(field);
  if (raw === null || raw.trim() === "") {
    return null;
  }
  const micros = Number(raw);
  if (!Number.isFinite(micros) || micros < 0) {
    return null;
  }
  const totalSeconds = Math.round(micros / 1_000_000);
  if (totalSeconds < 60) {
    return `${String(totalSeconds)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return `${String(minutes)}m ${String(seconds).padStart(2, "0")}s`;
  }
  const hours = Math.floor(minutes / 60);
  return `${String(hours)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

function asText(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/** A visit's page: its title over its URL (the phone card's title). */
function VisitPage({ row }: { readonly row: Finding }) {
  return (
    <TwoLineCell
      primary={row.fields.title}
      secondary={row.fields.url}
      mono={false}
    />
  );
}

/** The table's page cell: the site tile, the title over the URL, and the
 *  URL's host linked to Sites when Sites lists that exact host. */
function VisitPageLinked({ row }: { readonly row: Finding }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar host={hostOf(fieldText(row.fields.url))} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="block min-w-0 text-foreground">
          <FieldCell field={row.fields.title} mono={false} />
        </span>
        <SizeProvider size="compact">
          <span className="block min-w-0 text-muted-foreground">
            <UrlWithSiteLink field={row.fields.url} />
          </span>
        </SizeProvider>
      </span>
    </span>
  );
}

/** The visit table's columns, and where each sits in the stacked card on a
 *  phone (`ResponsiveRows`): time and (recovered only) State on the first
 *  line, the page as the card's title, transition and dwell under it. Every
 *  column but Page has a fixed width that fits its longest value, so Page
 *  takes the rest and no column moves when a day, a range or a tab changes
 *  the rows. The table links each URL's host to Sites (not a phone card:
 *  it is one button, and the row sheet carries the same link). */
function visitColumns(recovered: boolean): readonly RowColumn<Finding>[] {
  const columns: RowColumn<Finding>[] = [
    {
      key: "time",
      header: "Time (UTC)",
      label: "Time",
      className: "w-[184px] whitespace-nowrap",
      stack: "lead",
      cell: (row) => <TimeCell field={row.fields.visitTime} />,
    },
    {
      key: "page",
      header: "Page",
      className: "max-w-[440px]",
      stack: "title",
      cell: (row) => <VisitPageLinked row={row} />,
      stackedCell: (row) => <VisitPage row={row} />,
    },
    ...VISIT_DETAIL_COLUMNS,
  ];
  if (recovered) {
    columns.push(STATE_COLUMN);
  }
  return columns;
}

/** Arrived via and Dwell: the same in both lists. */
const VISIT_DETAIL_COLUMNS: readonly RowColumn<Finding>[] = [
  {
    key: "transition",
    header: "Arrived via",
    className: "w-[168px] whitespace-nowrap",
    cell: (row) => (
      <FieldCell
        field={row.fields.transitionCore}
        format={(value) => TRANSITION_LABELS[asText(value)] ?? asText(value)}
      />
    ),
  },
  {
    key: "dwell",
    header: (
      <Term label="Dwell">
        How long Chrome recorded the page as open. &quot;absent&quot; means
        Chrome kept no duration for that visit - it is not zero.
      </Term>
    ),
    label: "Dwell",
    className: "w-[96px] whitespace-nowrap tabular-nums",
    labelled: true,
    cell: (row) =>
      formatDwell(row.fields.visitDuration) ?? (
        <FieldCell field={row.fields.visitDuration} />
      ),
  },
];

/** The Recovered list adds the Commit State word (unsaved vs overwritten);
 *  in the Saved list every row would read "saved", so it is left out. */
const STATE_COLUMN: RowColumn<Finding> = {
  key: "state",
  header: "State",
  className: "w-[184px]",
  stack: "aside",
  cell: (row) => <StateWord state={row.commitState} />,
};

/** A visit's stable key: its row reference (file, table, row id, profile,
 *  Commit State), so a re-sort or a new page re-renders no kept row. */
function visitKey(row: Finding, index: number): string {
  return rowRefOf(row) ?? `${row.commitState}-${String(index)}`;
}

function visitLabel(row: Finding): string {
  return `Open visit row detail: ${fieldText(row.fields.title) ?? fieldText(row.fields.url) ?? "page visit"}`;
}

function VisitTable({
  rows,
  recovered,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly recovered: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  const columns = useMemo(() => visitColumns(recovered), [recovered]);
  return (
    <ResponsiveRows
      rows={rows}
      columns={columns}
      rowKey={visitKey}
      rowLabel={visitLabel}
      onSelect={onSelect}
      tableClassName="min-w-[760px]"
    />
  );
}

/** One of the two visit lists (Saved or Recovered): skeleton, rows, empty,
 *  errors and footer from the shared list block. */
export function VisitList({
  list,
  recovered,
  filters,
  filtersActive,
  onSelect,
  onClearFilters,
}: {
  readonly list: PaginatedList<Finding>;
  readonly recovered: boolean;
  readonly filters: VisitFilters;
  readonly filtersActive: boolean;
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  return (
    <ListBlock
      list={list}
      noun={
        recovered
          ? { one: "recovered visit", many: "recovered visits" }
          : { one: "saved visit", many: "saved visits" }
      }
      skeletonRows={recovered ? 3 : 8}
      filtered={filtersActive}
      filteredMessage={filteredEmptyMessage(
        filters,
        recovered ? "recovered visits" : "saved visits",
      )}
      onClearFilters={onClearFilters}
      empty={
        <EmptyRows
          title={recovered ? "No recovered visits" : "No saved visits"}
          message={
            recovered
              ? "Neither the write-ahead log nor the rollback journal holds a visit row."
              : "The History database holds no committed visit rows."
          }
        />
      }
    >
      <VisitTable rows={list.rows} recovered={recovered} onSelect={onSelect} />
    </ListBlock>
  );
}
