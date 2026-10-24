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
 * J / K (and ↑ / ↓ on a row) move between rows (`useRowKeyboardNav`).
 *
 * Built for Case-sized lists (thousands of rows):
 *  - one layout is mounted, picked by `matchMedia` (`useMediaQuery`), never
 *    both with one hidden by CSS;
 *  - past `WINDOW_THRESHOLD` rows the list is windowed (`useWindowedRows`):
 *    only rows near the viewport are in the DOM, the table keeps its
 *    semantics (`aria-rowcount` on the table, `aria-rowindex` on each row;
 *    `aria-setsize` / `aria-posinset` on the cards), and the focused row
 *    stays mounted;
 *  - rows are memoised: pass stable `columns`, `rowKey`, `onSelect` and
 *    `rowLabel` (module constants or `useMemo` / `useCallback`) and a
 *    scroll or a parent re-render re-renders no row;
 *  - the `reveal-items` hand-over plays once, for the rows on show when the
 *    list lands; rows that mount later (scrolling, filtering) just appear.
 */
import {
  Fragment,
  memo,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

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

import { useRowKeyboardNav } from "../shortcuts.js";
import { activateOnKey, ROW_FOCUS_CLASS } from "./data-table.js";
import { SM_UP, useMediaQuery } from "./use-media-query.js";
import {
  ROW_INDEX_ATTRIBUTE,
  useWindowedRows,
  WINDOW_THRESHOLD,
  type WindowItem,
} from "./use-windowed-rows.js";

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
 * below `sm`. See the module note for the column roles and for what keeps
 * a long list fast.
 *
 *   <ResponsiveRows
 *     rows={rows}
 *     columns={VISIT_COLUMNS}
 *     rowKey={visitKey}
 *     rowLabel={visitLabel}
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
  const wide = useMediaQuery(SM_UP);
  const navRef = useRef<HTMLDivElement>(null);
  useRowKeyboardNav(navRef);
  const revealing = useFirstReveal();
  const shared = { rows, columns, rowKey, onSelect, rowLabel, size, revealing };
  return (
    <div ref={navRef} className={cn("min-w-0", className)}>
      {wide ? (
        <TableRows {...shared} tableClassName={tableClassName} />
      ) : (
        <StackedRows {...shared} />
      )}
    </div>
  );
}

/** True while the list's first rows hand over (`reveal-items`, 8 steps of
 *  60ms plus a 200ms entrance); after that rows mount without motion. */
function useFirstReveal(): boolean {
  const [revealing, setRevealing] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => {
      setRevealing(false);
    }, 800);
    return () => {
      clearTimeout(timer);
    };
  }, []);
  return revealing;
}

interface RowsProps<Row> {
  readonly rows: readonly Row[];
  readonly columns: readonly RowColumn<Row>[];
  readonly rowKey: (row: Row, index: number) => string;
  readonly onSelect?: (row: Row) => void;
  readonly rowLabel?: (row: Row, index: number) => string;
  readonly size?: SizeVariant;
  readonly revealing: boolean;
}

/** Estimated heights before a row is measured: a 36px table row plus its
 *  hairline, a two-line card. */
const TABLE_ROW_ESTIMATE = 37;
const CARD_ESTIMATE = 64;

function TableRows<Row>({
  rows,
  columns,
  rowKey,
  onSelect,
  rowLabel,
  size,
  revealing,
  tableClassName,
}: RowsProps<Row> & { readonly tableClassName?: string }) {
  const windowed = rows.length > WINDOW_THRESHOLD;
  const { listRef, items } = useWindowedRows({
    count: rows.length,
    estimate: TABLE_ROW_ESTIMATE,
    enabled: windowed,
    resetKey: rows,
  });
  return (
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
      <Table
        size={size}
        className={tableClassName}
        aria-rowcount={windowed ? rows.length + 1 : undefined}
      >
        <TableHeader>
          <TableRow aria-rowindex={windowed ? 1 : undefined}>
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
        <TableBody
          ref={listRef}
          data-row-nav-list=""
          className={revealing ? "reveal-items" : undefined}
        >
          {items.map((item) => {
            if (item.kind === "gap") {
              return (
                <tr key={item.key} aria-hidden="true">
                  <td
                    colSpan={columns.length}
                    style={{ height: item.height, padding: 0, border: 0 }}
                  />
                </tr>
              );
            }
            const row = rows[item.index] as Row;
            return (
              <BodyRow
                key={rowKey(row, item.index)}
                row={row}
                index={item.index}
                columns={columns}
                onSelect={onSelect}
                label={rowLabel?.(row, item.index)}
                windowed={windowed}
              />
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** One table row; re-renders only when its own props change. */
const BodyRow = memo(function BodyRow<Row>({
  row,
  index,
  columns,
  onSelect,
  label,
  windowed,
}: {
  readonly row: Row;
  readonly index: number;
  readonly columns: readonly RowColumn<Row>[];
  readonly onSelect?: (row: Row) => void;
  readonly label?: string;
  readonly windowed: boolean;
}) {
  const open =
    onSelect === undefined
      ? undefined
      : () => {
          onSelect(row);
        };
  return (
    <TableRow
      index={index}
      {...{ [ROW_INDEX_ATTRIBUTE]: index }}
      data-row-nav={open === undefined ? undefined : ""}
      aria-rowindex={windowed ? index + 2 : undefined}
      tabIndex={open === undefined ? undefined : 0}
      aria-label={label}
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
}) as <Row>(props: {
  readonly row: Row;
  readonly index: number;
  readonly columns: readonly RowColumn<Row>[];
  readonly onSelect?: (row: Row) => void;
  readonly label?: string;
  readonly windowed: boolean;
}) => ReactNode;

function StackedRows<Row>({
  rows,
  columns,
  rowKey,
  onSelect,
  rowLabel,
  size,
  revealing,
}: RowsProps<Row>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(containerRef, { axis: "y" });
  const clickable = onSelect !== undefined;
  const windowed = rows.length > WINDOW_THRESHOLD;
  const { listRef, items } = useWindowedRows({
    count: rows.length,
    estimate: CARD_ESTIMATE,
    enabled: windowed,
    resetKey: rows,
  });
  return (
    <div
      ref={containerRef}
      {...(clickable ? hover.handlers : {})}
      className="relative px-1 py-1"
    >
      {clickable ? (
        <FluidHoverHighlight hover={hover} className="rounded-lg" />
      ) : null}
      <ul
        ref={listRef}
        data-row-nav-list=""
        className={cn(
          "flex flex-col divide-y divide-border",
          revealing && "reveal-items",
        )}
      >
        {items.map((item: WindowItem) => {
          if (item.kind === "gap") {
            return (
              <li
                key={item.key}
                aria-hidden="true"
                style={{ height: item.height }}
              />
            );
          }
          const row = rows[item.index] as Row;
          return (
            <StackedRow
              key={rowKey(row, item.index)}
              row={row}
              index={item.index}
              setSize={windowed ? rows.length : undefined}
              columns={columns}
              onSelect={onSelect}
              label={rowLabel?.(row, item.index)}
              hover={clickable ? hover : undefined}
              size={size}
            />
          );
        })}
      </ul>
    </div>
  );
}

/** The props of one stacked card. */
interface StackedRowProps<Row> {
  readonly row: Row;
  readonly index: number;
  /** The full list's length when windowed (`aria-setsize`). */
  readonly setSize?: number;
  readonly columns: readonly RowColumn<Row>[];
  readonly onSelect?: (row: Row) => void;
  readonly label?: string;
  readonly hover?: UseFluidHoverReturn;
  readonly size?: SizeVariant;
}

/** One stacked card; re-renders only when its own props change. */
const StackedRow = memo(function StackedRow<Row>({
  row,
  index,
  setSize,
  columns,
  onSelect,
  label,
  hover,
  size: sizeVariant,
}: {
  readonly row: Row;
  readonly index: number;
  readonly setSize?: number;
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
    <li
      className="min-w-0"
      {...{ [ROW_INDEX_ATTRIBUTE]: index }}
      aria-setsize={setSize}
      aria-posinset={setSize === undefined ? undefined : index + 1}
    >
      <div
        ref={ref}
        data-row-nav={open === undefined ? undefined : ""}
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
            {/* Every item carries its own leading " · " in a fixed 16px
                slot, and the row is pulled 16px left inside a clipping
                box: the separator that would start a wrapped line falls
                in the clipped strip, so a line never ends or starts on a
                dangling dot, and a segment never splits from its dot. */}
            <div className="min-w-0 overflow-hidden">
              <div
                className={cn(
                  size.type.caption,
                  "-ml-4 flex min-w-0 flex-wrap items-baseline text-muted-foreground",
                )}
              >
                {meta.map((column) => (
                  <Fragment key={column.key}>
                    <span className="inline-flex min-w-0 max-w-full items-baseline">
                      <span
                        aria-hidden="true"
                        className="w-4 shrink-0 text-center"
                      >
                        ·
                      </span>
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
                    </span>
                  </Fragment>
                ))}
              </div>
            </div>
          </SizeProvider>
        )}
      </div>
    </li>
  );
}) as <Row>(props: StackedRowProps<Row>) => ReactNode;
