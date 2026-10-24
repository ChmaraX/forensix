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
 *
 * `redactedFields` names fields that hold secrets (a cookie value, a payment
 * card number). Each recorded, non-empty one opens as the words "value
 * hidden" with a Reveal button beside it, hidden every time the sheet opens;
 * "(empty)", "absent" and "unavailable" still show as they are, since none
 * of them carries a secret.
 */
import { useEffect, useState, type ReactNode } from "react";

import type { FieldState, Finding } from "../types.js";
import { CommitBadge } from "../terms.js";
import { Button } from "@/components/ui/button";
import { InputCopy } from "@/components/ui/input-copy";
import { Tooltip } from "@/components/ui/tooltip";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { HideIcon, ShowIcon } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { AbsentWord, FieldStateText } from "./field-state.js";
import { profileLabel } from "./finding-fields.js";

export type SelectedRow = { readonly kind: "finding"; readonly row: Finding };

export {
  COOKIE_SECRET_FIELDS,
  CREDENTIAL_SECRET_FIELDS,
  SEALED_REASON,
  secretFieldsOf,
} from "./secrets.js";

/** "value hidden": a recorded secret withheld until "Show values" is on.
 *  No own tab stop: the row is the focus target and its sheet the reveal.
 *  `hint` is the tooltip; a page without a "Show values" Switch names only
 *  the sheet. */
export function HiddenValue({
  hint = "Turn on Show values, or open the row, to read it.",
}: {
  readonly hint?: string;
}) {
  const size = useSize();
  return (
    <Tooltip content={hint}>
      <span
        className={cn(
          size.type.body,
          "flex cursor-help items-center gap-1.5 whitespace-nowrap text-muted-foreground",
        )}
      >
        <HideIcon size={size.icon} strokeWidth={1.5} className="shrink-0" />
        {/* The words give the element its baseline (not the icon's box),
            so it sits on a caption line's baseline beside other text. */}
        <span className="self-baseline">value hidden</span>
      </span>
    </Tooltip>
  );
}

/**
 * A secret field in a table cell: a recorded, non-empty value reads "value
 * hidden" until `reveal`; "(empty)", "absent" and "unavailable" show as
 * they are, since none of them carries a secret.
 */
export function SecretValueCell({
  field,
  reveal,
  hint,
  mono = "auto",
  className,
}: {
  readonly field: FieldState | undefined;
  readonly reveal: boolean;
  /** The hidden value's tooltip (`HiddenValue`). */
  readonly hint?: string;
  /** The revealed value's monospace rule (`FieldStateText`'s), e.g. `true`
   *  for cookie values, which are tokens. @default "auto" */
  readonly mono?: boolean | "auto";
  readonly className?: string;
}) {
  if (field?.state === "value" && field.value !== "" && !reveal) {
    return <HiddenValue hint={hint} />;
  }
  return (
    <span className={cn("block min-w-0", className)}>
      {field === undefined ? (
        <AbsentWord />
      ) : (
        <FieldStateText field={field} truncate mono={mono} />
      )}
    </span>
  );
}

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

/**
 * A wire field that holds an id, hash or key (`visitId`, `bitmapId`,
 * `payloadSha256`, `entryHash`): its value is monospace whatever it looks
 * like, so "visitId 500106" reads in the same face as the source chain's
 * "Row id 500106" above it.
 */
function isIdField(name: string): boolean {
  return /(?:^id$|Ids?$|ID$|Hash$|Sha256$|Guid$|Uuid$)/.test(name);
}

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

/** A redacted field: "value hidden" until revealed, then the value with a
 *  Hide button. Only a recorded, non-empty value is ever withheld. */
function RedactedValue({
  field,
  mono,
}: {
  readonly field: FieldState;
  readonly mono: boolean | "auto";
}) {
  const size = useSize();
  const [revealed, setRevealed] = useState(false);
  if (field.state !== "value" || field.value === "") {
    return <FieldStateText field={field} mono={mono} />;
  }
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      {revealed ? (
        <span className="min-w-0">
          <FieldStateText field={field} mono={mono} />
        </span>
      ) : (
        <span
          className={cn(
            size.type.body,
            "inline-flex items-center gap-1.5 text-muted-foreground",
          )}
        >
          <HideIcon size={size.icon} strokeWidth={1.5} className="shrink-0" />
          value hidden
        </span>
      )}
      <Button
        variant="ghost"
        size="compact"
        leadingIcon={revealed ? HideIcon : ShowIcon}
        aria-pressed={revealed}
        onClick={() => {
          setRevealed((current) => !current);
        }}
        className="-my-1 shrink-0"
      >
        {revealed ? "Hide" : "Reveal"}
      </Button>
    </div>
  );
}

export function RowSheet({
  selected,
  onClose,
  title,
  redactedFields,
  children,
}: {
  readonly selected: SelectedRow;
  readonly onClose: () => void;
  /** Replaces the row kind as the sheet title (e.g. "Page visit"). The
   *  kind still shows in the description. */
  readonly title?: ReactNode;
  /** Field names whose recorded values stay hidden until the examiner
   *  reveals them (e.g. `["value"]` for a cookie). */
  readonly redactedFields?: readonly string[];
  /** Optional page-specific summary, rendered above the source chain. */
  readonly children?: ReactNode;
}) {
  const size = useSize();
  const { row } = selected;
  const fields = Object.entries(row.fields);
  // The sheet opens from a row (focused by its click or its Enter), not from
  // a Radix trigger, and the page unmounts it on close; so the row to return
  // focus to is the element focused when the sheet first rendered. Escape,
  // the close button and the overlay all hand focus back to it.
  const [returnFocus] = useState<HTMLElement | null>(() =>
    document.activeElement instanceof HTMLElement &&
    document.activeElement !== document.body
      ? document.activeElement
      : null,
  );
  useEffect(
    () => () => {
      requestAnimationFrame(() => {
        if (
          returnFocus?.isConnected === true &&
          (document.activeElement === null ||
            document.activeElement === document.body)
        ) {
          returnFocus.focus({ preventScroll: true });
        }
      });
    },
    [returnFocus],
  );

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent
        onCloseAutoFocus={(event) => {
          if (returnFocus?.isConnected === true) {
            event.preventDefault();
            returnFocus.focus({ preventScroll: true });
          }
        }}
      >
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
              <span className="text-foreground">
                {profileLabel(row.profile)}
              </span>
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
                      {redactedFields?.includes(name) === true ? (
                        <RedactedValue
                          field={field}
                          mono={isIdField(name) ? true : "auto"}
                        />
                      ) : (
                        <FieldStateText
                          field={field}
                          mono={isIdField(name) ? true : "auto"}
                        />
                      )}
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
