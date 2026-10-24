/**
 * Row detail side panel (the FF-style Sheet from ui/sheet): every field of
 * the selected row with its state word, plus the resolvable source chain
 * (manifest path · table · rowid) as FF InputCopy rows.
 *
 * Layout: the header names the row kind, its Commit State badge and its
 * Profile; the body is two quiet sections — "Where this comes from" and
 * "Fields" — each a hairline-separated property list. Nothing is coloured
 * without its word: values, (empty), absent and unavailable read as words
 * (field-state.tsx).
 */
import type { ReactNode } from "react";

import type { Finding } from "../types.js";
import { CommitBadge } from "../terms.js";
import { InputCopy } from "@/components/ui/input-copy";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { fontWeights } from "@/lib/font-weight";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { FieldStateText } from "./field-state.js";

export type SelectedRow = { readonly kind: "finding"; readonly row: Finding };

function SectionTitle({ children }: { readonly children: ReactNode }) {
  const size = useSize();
  return (
    <h3
      className={cn(size.type.subtitle, "mb-1 text-foreground")}
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {children}
    </h3>
  );
}

/** Name / value rows sharing one two-column grid (stacked when narrow). */
const PROPERTY_ROW =
  "grid grid-cols-1 items-center gap-x-4 sm:grid-cols-[minmax(0,11rem)_minmax(0,1fr)]";

/** One source-chain line: an FF InputCopy, or the word "absent". */
function ProvenanceLine({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | undefined;
}) {
  const size = useSize();
  const absent = value === undefined || value.length === 0;
  return (
    <div className={PROPERTY_ROW}>
      <dt className={cn(size.type.body, "pt-2 text-muted-foreground sm:pt-0")}>
        {label}
      </dt>
      <dd className="min-w-0">
        {absent ? (
          <span
            className={cn(size.type.body, "block py-2 text-muted-foreground")}
          >
            absent
          </span>
        ) : (
          <InputCopy
            value={value}
            title={value}
            role="group"
            aria-label={label}
            // Evidence paths stay readable in full: the value wraps instead
            // of truncating (the whole row still copies it).
            className="[&_.truncate]:break-all [&_.truncate]:whitespace-normal"
          />
        )}
      </dd>
    </div>
  );
}

export function RowSheet({
  selected,
  onClose,
  title,
  children,
}: {
  readonly selected: SelectedRow;
  readonly onClose: () => void;
  /** Replaces the row kind as the sheet title (e.g. "Page visit"). The
   *  kind still shows in the description. */
  readonly title?: ReactNode;
  /** Optional page-specific summary, rendered above the source chain. */
  readonly children?: ReactNode;
}) {
  const size = useSize();
  const { row } = selected;
  const fields = Object.entries(row.fields);

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent>
        <SheetHeader className="gap-2 border-b border-border pb-4">
          <SheetTitle className="break-words">
            {title ?? row.findingKind}
          </SheetTitle>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CommitBadge state={row.commitState} />
            <SheetDescription className="min-w-0">
              {title === undefined ? null : (
                <>
                  <span className="font-mono">{row.findingKind}</span>
                  {" · "}
                </>
              )}
              Profile <span className="text-foreground">{row.profile}</span>
            </SheetDescription>
          </div>
        </SheetHeader>

        <SheetBody className="flex flex-col gap-6 pt-4">
          {children}

          <section aria-label="Source">
            <SectionTitle>Where this comes from</SectionTitle>
            <dl className="flex flex-col divide-y divide-border">
              <ProvenanceLine
                label="File"
                value={row.provenance.manifestPath}
              />
              <ProvenanceLine label="Table" value={row.provenance.table} />
              <ProvenanceLine label="Row id" value={row.provenance.rowId} />
            </dl>
          </section>

          <section aria-label="Fields">
            <div className="flex items-baseline gap-2">
              <SectionTitle>Fields</SectionTitle>
              <span
                className={cn(
                  size.type.caption,
                  "text-muted-foreground tabular-nums",
                )}
              >
                {fields.length}
              </span>
            </div>
            {fields.length === 0 ? (
              <p className={cn(size.type.body, "py-2 text-muted-foreground")}>
                This row carries no fields.
              </p>
            ) : (
              <dl className="flex flex-col divide-y divide-border">
                {fields.map(([name, field]) => (
                  <div
                    key={name}
                    className={cn(PROPERTY_ROW, "items-start gap-y-0.5 py-2")}
                  >
                    <dt
                      className={cn(
                        size.type.body,
                        "break-words text-muted-foreground",
                      )}
                    >
                      {name}
                    </dt>
                    <dd className="min-w-0 text-foreground">
                      <FieldStateText field={field} />
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}
