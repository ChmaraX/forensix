/**
 * One evidence list, two layouts: an FF Table from `sm` up, and below it
 * (a phone, 390px) a stacked list of row cards, so no row needs a sideways
 * scroll to show what it is.
 *
 * Columns are declared once. Each says where it goes in the card (`stack`):
 *
 *   lead   first line, left, caption (TYPE, or the time on a time-ordered
 *          list) — always visible
 *   aside  first line, right (the State word) — always visible
 *   title  the card's main line, body
 *   meta   one caption line under it, items joined by " · "
 *   hidden table only (the row sheet still has every field)
 *
 * Clickable rows (`onSelect`) answer click, Enter and Space in both
 * layouts; the table rows keep FF's own fluid hover, and the cards get the
 * same one-highlight-per-list (`useFluidHover` + `FluidHoverHighlight`).
 */
import { Fragment, useRef, type ReactNode } from "react";

import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
  type UseFluidHoverReturn,
} from "@/hooks/use-fluid-hover";
import { SizeProvider, useSize, type SizeVariant } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { activateOnKey, ROW_FOCUS_CLASS } from "./data-table.js";

export interface RowColumn<Row> {
  readonly key: string;
  /** Column header (table) and, with `labelled`, the meta label (card).
   *  May be a node — e.g. a `Term` whose tooltip explains the column's
   *  values; the card then uses `label`. */
  readonly header: ReactNode;
  /** Plain words for the card's meta label when `header` is not a string.
   *  @default header (when it is a string) */
  readonly label?: string;
  readonly cell: (row: Row, index: number) => ReactNode;
  /** Classes for this column's head and cells in the table. */
  readonly className?: string;
  /** Place in the stacked card below `sm`. @default "meta" */
  readonly stack?: "lead" | "aside" | "title" | "meta" | "hidden";
  /** What the card shows instead of `cell` (e.g. without an avatar). */
  readonly stackedCell?: (row: Row, index: number) => ReactNode;
  /** Prefix a meta item with its header ("Dwell 2m"). @default false */
  readonly labelled?: boolean;
}

/**
 * An evidence list that is a table on wide screens and stacked row cards
 * below `sm`. See the module note for the column roles.
 *
 *   <ResponsiveRows
 *     rows={rows}
 *     columns={VISIT_COLUMNS}
 *     rowKey={(row, i) => `${row.commitState}-${i}`}
 *     rowLabel={(row) => `Open visit row detail: ${title(row)}`}
 *     onSelect={onSelect}
 *     tableClassName="min-w-[760px]"
 *   />
 */
export function ResponsiveRows<Row>({
  rows,
  columns,
  rowKey,
  onSelect,
  rowLabel,
  tableClassName,
  size,
  className,
}: {
  readonly rows: readonly Row[];
  readonly columns: readonly RowColumn<Row>[];
  readonly rowKey: (row: Row, index: number) => string;
  /** Makes rows clickable (opens the row sheet). */
  readonly onSelect?: (row: Row) => void;
  /** Accessible name of a clickable row. */
  readonly rowLabel?: (row: Row, index: number) => string;
  /** Classes for the `Table` (usually a `min-w-[…]` for the scroller). */
  readonly tableClassName?: string;
  /** Pins the rows to one step of the size ladder. */
  readonly size?: SizeVariant;
  readonly className?: string;
}) {
  return (
    <div className={cn("min-w-0", className)}>
      <div className="scroll-fade-x overflow-x-auto px-1 py-1 max-sm:hidden [&_tbody>tr:last-child]:border-transparent">
        <Table size={size} className={tableClassName}>
          <TableHeader>
            <TableRow>
              {columns.map((column) => (
                <TableHead
                  key={column.key}
                  className={cn("whitespace-nowrap", column.className)}
                >
                  {column.header}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="reveal-items">
            {rows.map((row, index) => {
              const open =
                onSelect === undefined
                  ? undefined
                  : () => {
                      onSelect(row);
                    };
              return (
                <TableRow
                  key={rowKey(row, index)}
                  index={index}
                  tabIndex={open === undefined ? undefined : 0}
                  aria-label={rowLabel?.(row, index)}
                  onClick={open}
                  onKeyDown={
                    open === undefined
                      ? undefined
                      : (event) => {
                          activateOnKey(event, open);
                        }
                  }
                  className={open === undefined ? undefined : ROW_FOCUS_CLASS}
                >
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.className}>
                      {column.cell(row, index)}
                    </TableCell>
                  ))}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <StackedRows
        rows={rows}
        columns={columns}
        rowKey={rowKey}
        onSelect={onSelect}
        rowLabel={rowLabel}
        size={size}
      />
    </div>
  );
}

function StackedRows<Row>({
  rows,
  columns,
  rowKey,
  onSelect,
  rowLabel,
  size,
}: {
  readonly rows: readonly Row[];
  readonly columns: readonly RowColumn<Row>[];
  readonly rowKey: (row: Row, index: number) => string;
  readonly onSelect?: (row: Row) => void;
  readonly rowLabel?: (row: Row, index: number) => string;
  readonly size?: SizeVariant;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(containerRef, { axis: "y" });
  const clickable = onSelect !== undefined;
  return (
    <div
      ref={containerRef}
      {...(clickable ? hover.handlers : {})}
      className="relative px-1 py-1 sm:hidden"
    >
      {clickable ? (
        <FluidHoverHighlight hover={hover} className="rounded-lg" />
      ) : null}
      <ul className="reveal-items flex flex-col divide-y divide-border">
        {rows.map((row, index) => (
          <StackedRow
            key={rowKey(row, index)}
            row={row}
            index={index}
            columns={columns}
            onSelect={onSelect}
            label={rowLabel?.(row, index)}
            hover={clickable ? hover : undefined}
            size={size}
          />
        ))}
      </ul>
    </div>
  );
}

function StackedRow<Row>({
  row,
  index,
  columns,
  onSelect,
  label,
  hover,
  size: sizeVariant,
}: {
  readonly row: Row;
  readonly index: number;
  readonly columns: readonly RowColumn<Row>[];
  readonly onSelect?: (row: Row) => void;
  readonly label?: string;
  readonly hover?: UseFluidHoverReturn;
  readonly size?: SizeVariant;
}) {
  const size = useSize(sizeVariant);
  const ref = useRef<HTMLDivElement>(null);
  useRegisterFluidHoverItem(hover?.registerItem, index, ref);
  const show = (column: RowColumn<Row>) =>
    (column.stackedCell ?? column.cell)(row, index);
  const lead = columns.filter((column) => column.stack === "lead");
  const aside = columns.filter((column) => column.stack === "aside");
  const title = columns.filter((column) => column.stack === "title");
  const meta = columns.filter(
    (column) => column.stack === undefined || column.stack === "meta",
  );
  const open =
    onSelect === undefined
      ? undefined
      : () => {
          onSelect(row);
        };
  return (
    <li className="min-w-0">
      <div
        ref={ref}
        role={open === undefined ? undefined : "button"}
        tabIndex={open === undefined ? undefined : 0}
        aria-label={label}
        onClick={open}
        onKeyDown={
          open === undefined
            ? undefined
            : (event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  open();
                }
              }
        }
        className={cn(
          "relative flex min-w-0 flex-col gap-0.5 rounded-lg px-3 py-2.5",
          open !== undefined && ROW_FOCUS_CLASS,
        )}
      >
        {lead.length + aside.length === 0 ? null : (
          <SizeProvider size="compact">
            <div
              className={cn(
                size.type.caption,
                "flex min-w-0 items-center justify-between gap-3 text-muted-foreground",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                {lead.map((column) => (
                  <Fragment key={column.key}>{show(column)}</Fragment>
                ))}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {aside.map((column) => (
                  <Fragment key={column.key}>{show(column)}</Fragment>
                ))}
              </span>
            </div>
          </SizeProvider>
        )}
        {title.map((column) => (
          <div
            key={column.key}
            className={cn(size.type.body, "min-w-0 text-foreground")}
          >
            {show(column)}
          </div>
        ))}
        {meta.length === 0 ? null : (
          <SizeProvider size="compact">
            <div
              className={cn(
                size.type.caption,
                "flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-muted-foreground",
              )}
            >
              {meta.map((column, position) => (
                <Fragment key={column.key}>
                  {position === 0 ? null : <span aria-hidden="true">·</span>}
                  <span className="inline-flex min-w-0 items-baseline gap-1">
                    {column.labelled === true ? (
                      <span>
                        {column.label ??
                          (typeof column.header === "string"
                            ? column.header
                            : null)}
                      </span>
                    ) : null}
                    <span className="min-w-0 text-foreground">
                      {show(column)}
                    </span>
                  </span>
                </Fragment>
              ))}
            </div>
          </SizeProvider>
        )}
      </div>
    </li>
  );
}
