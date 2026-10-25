/**
 * Row detail side panel (the FF-style Sheet from ui/sheet): every field of
 * the selected row with its state word, plus the resolvable source chain
 * (manifest path · table · rowid) as FF InputCopy rows.
 *
 * Layout: the header names the row (its recorded name, else its kind), its
 * Commit State badge, its kind and Profile in words, and "Copy citation";
 * it stays put while the body scrolls. The body is three quiet sections —
 * "Where this comes from", "Related" (exact-value links to other pages,
 * related-links.tsx) and "Fields" — each a hairline-separated property
 * list. A field reads by its human label with the raw wire name as a mono
 * caption under it (field-labels.ts); timestamps read as the tables write
 * them ("12 Mar 2024 22:30:18 UTC", the ISO instant on hover). Nothing is
 * coloured without its word: values, (empty), absent and unavailable read
 * as words (field-state.tsx).
 *
 * "Copy citation" copies one line of provenance (artifact, profile, file,
 * table, row id, Commit State, any content hash the row records) for a
 * report - never a field value, so a secret stays out of it whether or
 * not it is revealed.
 *
 * `redactedFields` names fields that hold secrets (a cookie value, a payment
 * card number). Each recorded, non-empty one opens as the words "value
 * hidden" with a Reveal button beside it, hidden every time the sheet opens;
 * "(empty)", "absent" and "unavailable" still show as they are, since none
 * of them carries a secret.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";

import { artifactLabelOfKind, FINDING_KINDS } from "../artifacts.js";
import { fieldLabel } from "../field-labels.js";
import { citationOf } from "../related.js";
import { rowRefOf } from "../router.js";
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
import { useIcons } from "@/lib/icon-context";
import { useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";
import { AbsentWord, FieldStateText } from "./field-state.js";
import { fieldUtc, profileLabel } from "./finding-fields.js";
import { TimeText } from "./page-kit.js";
import { RelatedLinks } from "./related-links.js";
import { humanizeFieldValue } from "../field-values.js";

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
            // of truncating (the whole row still copies it), at its
            // separators ("/", "-", ".") first, mid-token only when one
            // segment cannot fit the width on its own.
            className="[&_.truncate]:whitespace-normal [&_.truncate]:[overflow-wrap:anywhere]"
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

/** The check FF's InputCopy draws on a copy, drawn on with its path. */
function CopiedCheck() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="2 4 20 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <motion.path
        d="M6 12L10 16L18 8"
        initial={{ pathLength: 0 }}
        animate={{
          pathLength: 1,
          transition: { duration: 0.08, ease: "easeOut" },
        }}
      />
    </svg>
  );
}

/** Copies `text` (the Clipboard API, else a hidden textarea). */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    area.remove();
    return ok;
  }
}

/**
 * "Copy citation": FF's copy confirmation (InputCopy's), on a compact
 * tertiary button - the icon swaps for a drawn check and the label for
 * "Copied" on `spring.fast`, the width held by an invisible longest label,
 * and a polite status line says what was copied.
 */
function CopyCitationButton({ citation }: { readonly citation: string }) {
  const icons = useIcons();
  const CopyIcon = icons.copy;
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [count, setCount] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
    },
    [],
  );
  const copy = useCallback(() => {
    void copyText(citation).then((ok) => {
      setStatus(ok ? "copied" : "failed");
      setCount((value) => value + 1);
      if (timer.current !== null) {
        clearTimeout(timer.current);
      }
      timer.current = setTimeout(() => {
        setStatus("idle");
      }, 2000);
    });
  }, [citation]);
  const label =
    status === "copied"
      ? "Copied"
      : status === "failed"
        ? "Copy failed"
        : "Copy citation";
  return (
    <>
      <Button
        variant="tertiary"
        size="compact"
        onClick={copy}
        title={citation}
        aria-label="Copy citation"
        className="shrink-0 sm:ml-auto"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={`${status}-${String(status === "idle" ? 0 : count)}`}
            className="flex items-center gap-1.5"
            initial={{ opacity: 0, scale: status === "idle" ? 0.8 : 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={spring.fast}
          >
            {status === "copied" ? (
              <CopiedCheck />
            ) : (
              <CopyIcon size={14} strokeWidth={1.5} aria-hidden="true" />
            )}
            <span className="inline-grid text-left">
              <span
                className="invisible col-start-1 row-start-1"
                aria-hidden="true"
              >
                Copy citation
              </span>
              <span className="col-start-1 row-start-1">{label}</span>
            </span>
          </motion.span>
        </AnimatePresence>
      </Button>
      <span role="status" className="sr-only">
        {status === "copied"
          ? "Citation copied."
          : status === "failed"
            ? "The citation could not be copied."
            : ""}
      </span>
    </>
  );
}

/** A timestamp field's value as the tables write it, plus "UTC"; an enum,
 *  boolean or byte count in words with the recorded value as a caption or
 *  on hover (`humanizeFieldValue`); anything else as its Field State text. */
function FieldValue({
  field,
  name,
  kind,
  mono,
}: {
  readonly field: FieldState;
  readonly name: string;
  readonly kind: string;
  readonly mono: boolean | "auto";
}) {
  const size = useSize();
  if (fieldUtc(field) !== null) {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
        <TimeText field={field} />
        <span className={cn(size.type.caption, "text-muted-foreground")}>
          UTC
        </span>
      </span>
    );
  }
  const human =
    field.state === "value"
      ? humanizeFieldValue(name, kind, field.value)
      : null;
  if (human !== null) {
    return (
      <span className="flex min-w-0 flex-col">
        <span className="tabular-nums" title={human.title}>
          {human.text}
        </span>
        {human.caption === undefined ? null : (
          <span
            className={cn(
              size.type.caption,
              "font-mono text-muted-foreground [overflow-wrap:anywhere]",
            )}
          >
            {human.caption}
          </span>
        )}
      </span>
    );
  }
  return <FieldStateText field={field} mono={mono} />;
}

/** Rows with no reference, each given its own key (by object identity). */
const unreferencedKeys = new WeakMap<Finding, string>();
let unreferencedCount = 0;

/** A key that differs for every row: its reference, or - fail closed - a
 *  key of its own when it has none. */
function rowKeyOf(row: Finding): string {
  const ref = rowRefOf(row);
  if (ref !== null) {
    return `ref:${ref}`;
  }
  let key = unreferencedKeys.get(row);
  if (key === undefined) {
    unreferencedCount += 1;
    key = `object:${String(unreferencedCount)}`;
    unreferencedKeys.set(row, key);
  }
  return key;
}

export function RowSheet({
  selected,
  onClose,
  title,
  redactedFields,
  related = true,
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
  /** The "Related" block (exact-value links to other pages). Turn off
   *  only where the sheet already sits on the related page. @default true */
  readonly related?: boolean;
  /** Optional page-specific summary, rendered above the source chain. */
  readonly children?: ReactNode;
}) {
  const size = useSize();
  const { row } = selected;
  const rowKey = rowKeyOf(row);
  const fields = Object.entries(row.fields);
  const kindNoun = FINDING_KINDS[row.findingKind]?.noun ?? row.findingKind;
  const citation = citationOf(row, {
    artifact: artifactLabelOfKind(row.findingKind),
    profile: profileLabel(row.profile),
    redacted: redactedFields,
  });
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
          document.activeElement !== null &&
          document.activeElement !== document.body
        ) {
          return;
        }
        if (returnFocus?.isConnected === true) {
          returnFocus.focus({ preventScroll: true });
          return;
        }
        // Opened from the URL (a refresh, Back, a link): no row was
        // focused, so focus lands on the page's heading, not the document.
        document
          .querySelector<HTMLElement>('main h1[tabindex="-1"]')
          ?.focus({ preventScroll: true });
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
          <SheetTitle className="break-words">{title ?? kindNoun}</SheetTitle>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <CommitBadge state={row.commitState} />
            <SheetDescription className="min-w-0">
              {title === undefined || title === kindNoun ? null : (
                <>
                  <span title={row.findingKind}>{kindNoun}</span>
                  {" · "}
                </>
              )}
              <span className="text-foreground">
                {profileLabel(row.profile)}
              </span>
            </SheetDescription>
            <CopyCitationButton citation={citation} />
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

          {related ? <RelatedLinks row={row} /> : null}

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
              // Keyed by the row: a revealed secret never carries over to
              // the next row the open sheet shows (a click, ⌘K) - its fields mount
              // afresh, hidden.
              <dl key={rowKey} className="flex flex-col divide-y divide-border">
                {fields.map(([name, field]) => (
                  <div
                    key={name}
                    className={cn(PROPERTY_ROW, "items-start gap-y-0.5 py-2")}
                  >
                    <dt className="flex min-w-0 flex-col">
                      <span
                        className={cn(
                          size.type.body,
                          "break-words text-muted-foreground",
                        )}
                      >
                        {fieldLabel(name, row.findingKind)}
                      </span>
                      <span
                        className={cn(
                          size.type.caption,
                          "font-mono text-muted-foreground [overflow-wrap:anywhere]",
                        )}
                      >
                        {name}
                      </span>
                    </dt>
                    <dd className="min-w-0 text-foreground">
                      {redactedFields?.includes(name) === true ? (
                        <RedactedValue
                          field={field}
                          mono={isIdField(name) ? true : "auto"}
                        />
                      ) : (
                        <FieldValue
                          field={field}
                          name={name}
                          kind={row.findingKind}
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
