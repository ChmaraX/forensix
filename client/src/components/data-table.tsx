/**
 * Evidence tables.
 *
 * Presentation rules enforced here:
 *  - TYPE is always the first column;
 *  - a field missing from a row renders as the word "absent";
 *  - Commit State is a worded badge with a plain-language tooltip;
 */
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../lib.js";
import { CommitBadge } from "../terms.js";
import type {
  Finding,
  Provenance,
} from "../types.js";
import { MaybeFieldStateText } from "./field-state.js";

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

function HeaderCell({
  children,
  className,
  title,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly title?: string;
}) {
  return (
    <th
      title={title}
      className={cn(
        "sticky top-0 z-10 border-b border-border bg-muted/80 px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase backdrop-blur",
        title !== undefined &&
          "cursor-help decoration-dotted underline underline-offset-2",
        className,
      )}
    >
      {children}
    </th>
  );
}

function SourceRowCell({ provenance }: { readonly provenance: Provenance }) {
  const text = provenanceText(provenance);
  return (
    <td className="max-w-[220px] px-3 py-2">
      <span
        title={text}
        className="block truncate font-mono text-[11.5px] whitespace-nowrap text-muted-foreground"
      >
        {text}
      </span>
    </td>
  );
}

export function EmptyRows({ message }: { readonly message: string }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <Inbox aria-hidden="true" className="size-6 text-muted-foreground/40" />
      <p className="text-[13px] text-muted-foreground">{message}</p>
    </div>
  );
}

const ROW_CLASS =
  "cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-accent/40";

export function FindingsTable({
  rows,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly onSelect: (row: Finding) => void;
}) {
  if (rows.length === 0) {
    return <EmptyRows message="No rows for this filter." />;
  }
  const columns = collectColumns(rows);
  return (
    <div className="fx-scroll-x">
      <table className="w-full text-left text-[13px] tabular-nums">
        <thead>
          <tr>
            <HeaderCell>Type</HeaderCell>
            <HeaderCell>Profile</HeaderCell>
            <HeaderCell>State</HeaderCell>
            <HeaderCell>Source row</HeaderCell>
            {columns.map((column) => (
              <HeaderCell key={column}>{column}</HeaderCell>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
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
              className={ROW_CLASS}
            >
              <td className="px-3 py-2 font-medium whitespace-nowrap">
                {row.findingKind}
              </td>
              <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                {row.profile}
              </td>
              <td className="px-3 py-2 whitespace-nowrap">
                <CommitBadge state={row.commitState} />
              </td>
              <SourceRowCell provenance={row.provenance} />
              {columns.map((column) => (
                <td key={column} className="max-w-[320px] px-3 py-2">
                  <MaybeFieldStateText field={row.fields[column]} truncate />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
