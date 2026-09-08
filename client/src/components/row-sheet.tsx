/**
 * Row detail panel (shadcn Sheet): every field of the selected row with its
 * state, plus the resolvable source chain (manifest path · table · rowid).
 */
import { Copy } from "lucide-react";
import { useState } from "react";

import type { Finding } from "../types.js";
import { CommitBadge } from "../terms.js";
import { Sheet, SheetContent, SheetTitle } from "./ui/sheet.js";
import { FieldStateText } from "./field-state.js";

export type SelectedRow = { readonly kind: "finding"; readonly row: Finding };

function ProvenanceLine({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string | undefined;
}) {
  const [copied, setCopied] = useState(false);
  if (value === undefined || value.length === 0) {
    return (
      <div className="flex items-baseline justify-between gap-3 py-1.5">
        <span className="text-[11px] tracking-wide text-muted-foreground uppercase">
          {label}
        </span>
        <span className="text-[13px] text-muted-foreground italic">absent</span>
      </div>
    );
  }
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <span className="pt-0.5 text-[11px] tracking-wide text-muted-foreground uppercase">
        {label}
      </span>
      <span className="flex min-w-0 items-start gap-1.5">
        <span className="font-mono text-[12px] break-all">{value}</span>
        <button
          type="button"
          aria-label={`Copy ${label}`}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              window.setTimeout(() => {
                setCopied(false);
              }, 1200);
            });
          }}
          className="mt-0.5 inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          {copied ? (
            <span className="text-[10px] font-medium text-primary">ok</span>
          ) : (
            <Copy aria-hidden="true" className="size-3" />
          )}
        </button>
      </span>
    </div>
  );
}

export function RowSheet({
  selected,
  onClose,
}: {
  readonly selected: SelectedRow;
  readonly onClose: () => void;
}) {
  const { row } = selected;
  const title = selected.row.findingKind;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent aria-describedby={undefined}>
        <header className="flex items-center gap-2.5 border-b border-border px-5 py-4 pr-12">
          <SheetTitle className="text-[15px] font-semibold">{title}</SheetTitle>
          <CommitBadge state={selected.row.commitState} />
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <section aria-label="Source" className="mb-5">
            <h3 className="mb-1 text-[13px] font-semibold">
              Where this comes from
            </h3>
            <div className="divide-y divide-border/70 rounded-md border border-border px-3">
              <ProvenanceLine
                label="File"
                value={row.provenance.manifestPath}
              />
              <ProvenanceLine label="Table" value={row.provenance.table} />
              <ProvenanceLine label="Row id" value={row.provenance.rowId} />
            </div>
          </section>

          <section aria-label="Row facts" className="mb-5">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              {"profile" in row ? (
                <div>
                  <span className="text-[11px] tracking-wide text-muted-foreground uppercase">
                    Profile
                  </span>
                  <p className="text-[13px]">{row.profile}</p>
                </div>
              ) : null}
            </div>
          </section>

          <section aria-label="Fields">
            <h3 className="mb-1 text-[13px] font-semibold">Fields</h3>
            <dl className="divide-y divide-border/70 rounded-md border border-border">
              {Object.entries(row.fields).map(([name, field]) => (
                <div key={name} className="px-3 py-2">
                  <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
                    {name}
                  </dt>
                  <dd className="mt-0.5">
                    <FieldStateText field={field} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
