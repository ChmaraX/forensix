/**
 * Evidence tables, on FF's Table.
 *
 * Presentation rules enforced here:
 *  - TYPE is always the first column;
 *  - a field missing from a row renders as the word "absent" (see
 *    field-state.tsx for the four value-state words);
 *  - Commit State is a state word (dot + word) with a plain-language
 *    tooltip — FF's in-cell form of the evidence badge.
 *
 * Every body row opens the row detail sheet, so every body row joins the
 * table's one fluid hover highlight (`TableRow index`): the lit row is the
 * row a click opens. Rows sit on the size ladder (36px, or 28px with
 * `size="compact"`). Wide tables scroll sideways under FF's `scroll-fade-x`.
 */
import { Inbox, type LucideIcon } from "lucide-react";
import type { KeyboardEvent, ReactNode } from "react";

import type { Finding, Provenance } from "../types.js";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fontWeights } from "@/lib/font-weight";
import { useSize, type SizeVariant } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { MaybeFieldStateText } from "./field-state.js";
import { StateWord } from "./finding-fields.js";

export function collectColumns(
  rows: readonly { readonly fields: Readonly<Record<string, unknown>> }[],
): readonly string[] {
  const columns: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row.fields)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

export function provenanceText(provenance: Provenance): string {
  return [provenance.manifestPath, provenance.table, provenance.rowId]
    .filter((part): part is string => part !== undefined && part.length > 0)
    .join(" · ");
}

/**
 * The empty state of a list or table: a quiet icon, the reason in words, and
 * an optional next step. `message` alone keeps the earlier one-line form.
 */
export function EmptyRows({
  message,
  title,
  icon: Icon = Inbox,
  action,
  className,
}: {
  /** What is (not) here, in plain words. */
  readonly message: ReactNode;
  /** Optional heading above the message (subtitle role). */
  readonly title?: ReactNode;
  /** Optional icon in place of the inbox. */
  readonly icon?: LucideIcon;
  /** Optional next step, e.g. a tertiary "Clear filter" Button. */
  readonly action?: ReactNode;
  readonly className?: string;
}) {
  const size = useSize();
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="mb-1 inline-flex size-9 items-center justify-center rounded-lg bg-hover text-muted-foreground"
      >
        <Icon size={size.icon} strokeWidth={1.5} />
      </span>
      {title === undefined ? null : (
        <p
          className={cn(size.type.subtitle, "text-foreground")}
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {title}
        </p>
      )}
      <p className={cn(size.type.body, "max-w-sm text-muted-foreground")}>
        {message}
      </p>
      {action === undefined ? null : <div className="mt-2">{action}</div>}
    </div>
  );
}

function SourceRowText({ provenance }: { readonly provenance: Provenance }) {
  const size = useSize();
  const text = provenanceText(provenance);
  if (text.length === 0) {
    return (
      <span className={cn(size.type.body, "text-muted-foreground")}>
        absent
      </span>
    );
  }
  return (
    <span
      title={text}
      className={cn(
        size.type.caption,
        "block truncate font-mono whitespace-nowrap text-muted-foreground",
      )}
    >
      {text}
    </span>
  );
}

/** Enter / Space on a focused row opens it, like a click. */
export function activateOnKey(
  event: KeyboardEvent<HTMLTableRowElement>,
  activate: () => void,
) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    activate();
  }
}

/** Focus ring for a clickable row (rows can't take a box-shadow ring). */
export const ROW_FOCUS_CLASS =
  "cursor-pointer outline-none focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-[color:var(--focus-ring,#6B97FF)]";

export function FindingsTable({
  rows,
  onSelect,
  emptyMessage = "No rows for this filter.",
  size,
  className,
}: {
  readonly rows: readonly Finding[];
  readonly onSelect: (row: Finding) => void;
  /** The empty state's words. @default "No rows for this filter." */
  readonly emptyMessage?: ReactNode;
  /** Pins rows to one ladder step (28px `compact`). Omitted, the table
   *  follows the surrounding SizeProvider. */
  readonly size?: SizeVariant;
  readonly className?: string;
}) {
  if (rows.length === 0) {
    return <EmptyRows message={emptyMessage} />;
  }
  const columns = collectColumns(rows);
  return (
    <div
      className={cn(
        "scroll-fade-x overflow-x-auto px-2 py-1 [&_tbody>tr:last-child]:border-transparent",
        className,
      )}
    >
      <Table size={size} className="tabular-nums">
        <TableHeader>
          <TableRow>
            <TableHead className="whitespace-nowrap">Type</TableHead>
            <TableHead className="whitespace-nowrap">Profile</TableHead>
            <TableHead className="whitespace-nowrap">State</TableHead>
            <TableHead className="whitespace-nowrap">Source row</TableHead>
            {columns.map((column) => (
              <TableHead key={column} className="whitespace-nowrap">
                {column}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => {
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
                <TableCell className="whitespace-nowrap text-foreground">
                  {row.findingKind}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {row.profile}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  <StateWord state={row.commitState} />
                </TableCell>
                <TableCell className="max-w-[220px]">
                  <SourceRowText provenance={row.provenance} />
                </TableCell>
                {columns.map((column) => (
                  <TableCell key={column} className="max-w-[320px]">
                    <MaybeFieldStateText field={row.fields[column]} truncate />
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
