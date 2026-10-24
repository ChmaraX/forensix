/**
 * The four value states, rendered as distinct words — never by color alone.
 *
 *  - value        the recorded value, mono at the surrounding body size (time
 *                 objects show their UTC form). It inherits the text color,
 *                 so an FF Table row lifts it from muted to foreground with
 *                 the rest of the row.
 *  - (empty)      present but empty: the word "(empty)", always muted.
 *  - absent       the field does not exist for this row: the word "absent",
 *                 always muted.
 *  - unavailable  could not be established: a red state dot, the word
 *                 "unavailable" and the typed reason. The hue rides the dot;
 *                 the word carries the meaning.
 *
 * Sizes follow the surrounding SizeProvider (`useSize().type.body`), so a
 * compact table gets compact values.
 */
import { formatValue } from "../lib.js";
import type { FieldState } from "../types.js";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { EvidenceDot } from "./evidence.js";

/** The word "absent", at the surrounding body size, always muted. */
export function AbsentWord() {
  const size = useSize();
  return (
    <span
      className={cn(size.type.body, "whitespace-nowrap text-muted-foreground")}
    >
      absent
    </span>
  );
}

export function FieldStateText({
  field,
  truncate = false,
}: {
  readonly field: FieldState;
  /** Table cells truncate to one line; the detail panel shows everything. */
  readonly truncate?: boolean;
}) {
  const size = useSize();
  if (field.state === "absent") {
    return <AbsentWord />;
  }
  if (field.state === "unavailable") {
    return (
      <span
        className={cn(
          size.type.body,
          "inline-flex max-w-full items-baseline gap-1.5",
          truncate ? "whitespace-nowrap" : "flex-wrap",
        )}
        title={truncate ? `unavailable — ${field.reason}` : undefined}
      >
        <EvidenceDot state="unavailable" className="self-center" />
        <span className="text-foreground">unavailable</span>
        <span
          className={cn(
            "min-w-0 text-muted-foreground",
            truncate ? "truncate" : "break-words",
          )}
        >
          — {field.reason}
        </span>
      </span>
    );
  }
  if (field.value === "") {
    return (
      <span
        className={cn(
          size.type.body,
          "whitespace-nowrap text-muted-foreground",
        )}
      >
        (empty)
      </span>
    );
  }
  const text = formatValue(field.value);
  return (
    <span
      className={cn(
        size.type.body,
        "font-mono",
        truncate ? "block truncate whitespace-nowrap" : "break-all",
      )}
      title={truncate ? text : undefined}
    >
      {text}
      {field.synthetic === true ? (
        <span
          className={cn(
            size.type.caption,
            "ml-1.5 font-sans text-muted-foreground",
          )}
        >
          (synthetic)
        </span>
      ) : null}
    </span>
  );
}

/** A field cell that may not exist for this row at all — rendered absent. */
export function MaybeFieldStateText({
  field,
  truncate = false,
}: {
  readonly field: FieldState | undefined;
  readonly truncate?: boolean;
}) {
  if (field === undefined) {
    return <AbsentWord />;
  }
  return <FieldStateText field={field} truncate={truncate} />;
}
