/**
 * The four value states, rendered as distinct words — never by color alone.
 *
 *  - value        recorded value (mono ink; time objects show their UTC form)
 *  - (empty)      present but empty (italic, dotted underline)
 *  - absent       the field does not exist for this row (italic, muted)
 *  - unavailable  could not be established, with a typed reason (red + word)
 */
import { cn, formatValue } from "../lib.js";
import type { FieldState } from "../types.js";

function AbsentWord() {
  return (
    <span className="text-[13px] text-muted-foreground italic">absent</span>
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
  if (field.state === "absent") {
    return <AbsentWord />;
  }
  if (field.state === "unavailable") {
    return (
      <span
        className={cn(
          "text-[13px] font-medium text-destructive",
          truncate && "block truncate",
        )}
        title={truncate ? `unavailable — ${field.reason}` : undefined}
      >
        unavailable
        <span className="font-normal opacity-80"> — {field.reason}</span>
      </span>
    );
  }
  if (field.value === "") {
    return (
      <span className="text-[13px] text-muted-foreground italic underline decoration-muted-foreground/50 decoration-dotted underline-offset-2">
        (empty)
      </span>
    );
  }
  const text = formatValue(field.value);
  return (
    <span
      className={cn(
        "font-mono text-[12.5px] text-foreground/90",
        truncate ? "block truncate whitespace-nowrap" : "break-all",
      )}
      title={truncate ? text : undefined}
    >
      {text}
      {field.synthetic === true ? (
        <span className="ml-1 text-[11px] text-muted-foreground italic">
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
