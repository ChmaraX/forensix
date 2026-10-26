/**
 * The four value states, rendered as distinct words — never by color alone.
 *
 *  - value        the recorded value at the surrounding body size (time
 *                 objects show their UTC form): proportional, or mono when
 *                 it is code-like (a URL, path, hash, raw key or id — see
 *                 `isCodeLike`; `mono` pins it). It inherits the text
 *                 color, so an FF Table row lifts it from muted to
 *                 foreground with the rest of the row.
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
import { Fragment, type ReactNode } from "react";

import type { FieldState } from "../types.js";
import { useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { EvidenceDot } from "./evidence.js";
import { Term } from "./term.js";

/** Render an arbitrary field value as text; time objects show their UTC form. */
function formatValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return typeof record.utc === "string" ? record.utc : JSON.stringify(value);
  }
  return String(value);
}

/**
 * Monospace is for values a person might copy or compare character by
 * character — never a costume for "technical". A value is code-like when it
 * is a URL (`https://…`, `chrome://…`, `about:blank`), a file path
 * (`C:\\…`, `/Users/…`, `Default/History`), a hex hash or UUID, a long
 * opaque token, a raw snake_case key (`browser_metadata`), or JSON. Names,
 * hostnames, locales, numbers and booleans are not.
 */
export function isCodeLike(text: string): boolean {
  const value = text.trim();
  if (value === "") {
    return false;
  }
  return (
    /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ||
    /^(about|data|blob|mailto|javascript|file):\S*$/i.test(value) ||
    /^[a-z]:[\\/]/i.test(value) ||
    /^(\\\\|\/|~\/|\.{1,2}\/)/.test(value) ||
    /^[^\s/]*[a-z][^\s/]*\/\S+$/i.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    ) ||
    (/^(0x)?[0-9a-f]{8,}$/i.test(value) && /[a-f]/i.test(value)) ||
    (/^[A-Za-z0-9+/_=-]{24,}$/.test(value) && /\d/.test(value)) ||
    (/^[a-z0-9]+(?:[_.-][a-z0-9]+)*$/i.test(value) && value.includes("_")) ||
    /^[[{]/.test(value)
  );
}

/** `"font-mono"` for a code-like value (`isCodeLike`), else `""`. Pinned
 *  with `mono`: `true` always mono, `false` never. */
export function codeClass(text: string, mono: boolean | "auto" = "auto") {
  return mono === true || (mono === "auto" && isCodeLike(text))
    ? "font-mono"
    : "";
}

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
  mono = "auto",
}: {
  readonly field: FieldState;
  /** Table cells truncate to one line; the detail panel shows everything. */
  readonly truncate?: boolean;
  /** Monospace for the value: `"auto"` when code-like (`isCodeLike`),
   *  `true` always, `false` never. @default "auto" */
  readonly mono?: boolean | "auto";
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
        title={truncate ? `unavailable - ${field.reason}` : undefined}
      >
        <EvidenceDot state="unavailable" className="self-center" />
        <span className="text-foreground">unavailable</span>
        <span
          className={cn(
            "min-w-0 text-muted-foreground",
            truncate ? "truncate" : "break-words",
          )}
        >
          - {field.reason}
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
  const code = codeClass(text, mono);
  return (
    <span
      className={cn(
        size.type.body,
        "tabular-nums",
        code,
        truncate
          ? "block truncate whitespace-nowrap"
          : code === ""
            ? "break-words"
            : // Code-like values (paths, URLs, hashes) break at their
              // separators first, mid-token only when a segment cannot fit.
              "[overflow-wrap:anywhere]",
      )}
      title={truncate ? text : undefined}
    >
      {truncate || code === "" ? text : breakAtSeparators(text)}
      {field.synthetic === true ? (
        <span
          className={cn(
            size.type.caption,
            "ml-1.5 font-sans text-muted-foreground",
          )}
        >
          {/* Said once, where it is shown: what "synthetic" means. */}
          <Term
            label="(synthetic)"
            technical="Technical: the value carries the analyzer's synthetic flag."
          >
            Put together by the analyzer from other recorded values (a
            bookmark's folder path from the folders above it) - the file stores
            no such single value.
          </Term>
        </span>
      ) : null}
    </span>
  );
}

/** Separators a code-like value may wrap after: path and URL delimiters. */
const SEPARATOR = /([/\\?&=#.:_-])/;

/**
 * A code-like value (path, URL, key) with a line-break opportunity after
 * each separator (`<wbr>`), so it wraps at "/" or "." rather than mid-token
 * ("…linkedin.com/logi / n"). `<wbr>` adds no character: the text selected
 * or copied is the recorded value exactly.
 */
export function breakAtSeparators(text: string): ReactNode {
  if (text.length < 24) {
    return text;
  }
  const parts = text.split(SEPARATOR);
  return parts.map((part, index) =>
    SEPARATOR.test(part) ? (
      <Fragment key={index}>
        {part}
        <wbr />
      </Fragment>
    ) : (
      part
    ),
  );
}

/** A field cell that may not exist for this row at all — rendered absent. */
export function MaybeFieldStateText({
  field,
  truncate = false,
  mono = "auto",
}: {
  readonly field: FieldState | undefined;
  readonly truncate?: boolean;
  /** See `FieldStateText`. @default "auto" */
  readonly mono?: boolean | "auto";
}) {
  if (field === undefined) {
    return <AbsentWord />;
  }
  return <FieldStateText field={field} truncate={truncate} mono={mono} />;
}
