/**
 * Shared readers and small renderers for curated Finding views. These never
 * invent data.
 *
 * The readers (`fieldText`, `fieldString`, `fieldBool`, `fieldUtc`,
 * `fieldInteger`) return the recorded value or `null` — and `null` covers
 * absent, (empty) AND unavailable alike. Use them for arithmetic, grouping
 * and sorting only. To *show* a field, render `FieldCell` (or `TimeCell` in
 * page-kit for timestamps) with the FieldState itself, so each of the four
 * states keeps its own word: the value, "(empty)", "absent", or
 * "unavailable — reason".
 */
import type { ReactNode } from "react";

import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { COMMIT_META } from "../terms.js";
import type { CommitState, FieldState } from "../types.js";
import { EvidenceDot } from "./evidence.js";
import { FieldStateText, MaybeFieldStateText } from "./field-state.js";
import { TermExplanation, TermTooltip } from "./term.js";

/** `"value"`-state non-empty string, or null. */
export function fieldText(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  return typeof field.value === "string" && field.value !== ""
    ? field.value
    : null;
}

/** `"value"`-state field as a plain string (numbers included), or null. */
export function fieldString(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value === "string") {
    return field.value === "" ? null : field.value;
  }
  if (typeof field.value === "number") {
    return String(field.value);
  }
  return null;
}

/** A `"value"`-state boolean, or null — booleans arrive as real `true`/`false`. */
export function fieldBool(field: FieldState | undefined): boolean | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  return typeof field.value === "boolean" ? field.value : null;
}

/** The UTC instant of a timestamp field (`{utc, ...}` value shape), or null. */
export function fieldUtc(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  if (typeof field.value !== "object" || field.value === null) {
    return null;
  }
  const utc = (field.value as Record<string, unknown>).utc;
  return typeof utc === "string" ? utc : null;
}

/** Integer carried as a string field (ranks, counts), or null. */
export function fieldInteger(field: FieldState | undefined): number | null {
  const text = fieldText(field);
  if (text === null) {
    return null;
  }
  const value = Number(text);
  return Number.isInteger(value) ? value : null;
}

/** "9 Dec 2024" / "14:32:07" (UTC) parts of an ISO instant, or null. */
export function formatInstant(
  utc: string,
): { date: string; time: string } | null {
  const parsed = new Date(utc);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return {
    date: parsed.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }),
    time: parsed.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZone: "UTC",
    }),
  };
}

/** The host of a URL, or null when the value is not a parseable URL. */
export function hostOf(url: string | null): string | null {
  if (url === null) {
    return null;
  }
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * One field in a table cell, with its own state word. A recorded, non-empty
 * value renders through `format` when given (a host, a size, a link label),
 * else as the raw value (truncated). Every other state renders its word —
 * "(empty)", "absent", "unavailable — reason" — never a blank and never
 * "absent" for a value that was unreadable. A field the row does not carry
 * at all (`undefined`) reads "absent".
 *
 * Monospace only for code-like values (URLs, paths, hashes, raw keys and
 * ids): `mono="auto"` (default) decides per value with `isCodeLike`; pin a
 * column with `mono` (a URL or path column) or `mono={false}` (names,
 * hosts, locales). A `format`ted value is proportional unless `mono`.
 *
 *   <FieldCell field={row.fields.hostKey} />
 *   <FieldCell field={row.fields.url} mono />
 *   <FieldCell field={row.fields.totalBytes} format={(v) => formatBytes(Number(v))} />
 */
export function FieldCell({
  field,
  format,
  truncate = true,
  mono = "auto",
  className,
}: {
  readonly field: FieldState | undefined;
  /** Renders a recorded, non-empty value. */
  readonly format?: (value: unknown) => ReactNode;
  /** One line with an ellipsis (table cells). @default true */
  readonly truncate?: boolean;
  /** Monospace: `"auto"` per value (`isCodeLike`), `true` always, `false`
   *  never. @default "auto" */
  readonly mono?: boolean | "auto";
  readonly className?: string;
}) {
  const size = useSize();
  if (
    format !== undefined &&
    field !== undefined &&
    field.state === "value" &&
    field.value !== ""
  ) {
    return (
      <span
        className={cn(
          size.type.body,
          mono === true && "font-mono",
          truncate ? "block truncate whitespace-nowrap" : "break-words",
          className,
        )}
      >
        {format(field.value)}
      </span>
    );
  }
  return field === undefined ? (
    <MaybeFieldStateText field={field} truncate={truncate} />
  ) : (
    <span className={cn("block min-w-0", className)}>
      <FieldStateText field={field} truncate={truncate} mono={mono} />
    </span>
  );
}

/**
 * The two-line cell every evidence table shares: the line a row reads by (a
 * title, a host, a cookie or user name) over the line that locates it (a
 * URL, a path, a realm) — muted, a step smaller (compact), always
 * monospace, since it is a value to copy. Both lines truncate with the full
 * text on hover. Each field keeps its own state word, so a missing title
 * reads "absent" above its URL instead of being papered over.
 *
 *  - `primary`: a FieldState, or text already read from the row (a host);
 *  - `secondary`: the locating field; `null` drops the second line;
 *  - `mono`: the primary line's monospace rule (`FieldCell`'s), e.g. `true`
 *    for a cookie name, `false` for a title. Text is never mono unless
 *    `true`. @default "auto"
 *  - `avatar`: a host for a leading `SiteAvatar` tile (`null` draws "?");
 *    omit for none (a stacked phone card).
 *
 *   <TwoLineCell primary={row.fields.title} secondary={row.fields.url} mono={false} />
 */
export function TwoLineCell({
  primary,
  secondary = null,
  mono = "auto",
  avatar,
}: {
  readonly primary: FieldState | string | undefined;
  readonly secondary?: FieldState | undefined | null;
  readonly mono?: boolean | "auto";
  readonly avatar?: string | null;
}) {
  const size = useSize();
  const first =
    typeof primary === "string" ? (
      <span
        className={cn(
          size.type.body,
          "block truncate text-foreground",
          mono === true && "font-mono",
        )}
        title={primary}
      >
        {primary}
      </span>
    ) : (
      <span className="block min-w-0 text-foreground">
        <FieldCell field={primary} mono={mono} />
      </span>
    );
  const lines =
    secondary === null ? (
      first
    ) : (
      <span className="flex min-w-0 flex-col">
        {first}
        <SizeProvider size="compact">
          <span className="block min-w-0 text-muted-foreground">
            <FieldCell field={secondary} mono />
          </span>
        </SizeProvider>
      </span>
    );
  if (avatar === undefined) {
    return lines;
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar host={avatar} />
      <span className="min-w-0 flex-1">{lines}</span>
    </span>
  );
}

/** Monospace rule for any value outside `FieldCell`: `isCodeLike(text)` and
 *  `codeClass(text, mono?)` (→ `"font-mono"` or `""`). */
export { codeClass, isCodeLike } from "./field-state.js";

/**
 * A Chrome profile directory as a person reads it: "Default" (and the
 * browser-wide ".") → "Default profile"; a name that already says
 * "Profile" ("Profile 2") stays as is; anything else gains " profile".
 * Use wherever the word "Profile" would otherwise be printed in front of
 * the name ("Profile Profile 2").
 */
export function profileLabel(profile: string): string {
  if (profile === "." || profile === "Default") {
    return "Default profile";
  }
  return /\bprofile\b/i.test(profile) ? profile : `${profile} profile`;
}

/** The word "absent" (one shared copy, from field-state.tsx). */
export { AbsentWord } from "./field-state.js";

const AVATAR_SIZE = {
  md: { box: "size-7 rounded-md", type: typeClass("caption") },
  lg: { box: "size-10 rounded-lg", type: typeClass("subtitle") },
  xl: { box: "size-13 rounded-xl", type: typeClass("title") },
} as const;

/**
 * Neutral letter tile standing in for a favicon; identity is the text. The
 * fill is FF's hover overlay (it reads on any surface level), the letter
 * muted at semibold.
 */
export function SiteAvatar({
  host,
  size = "md",
}: {
  readonly host: string | null;
  readonly size?: "md" | "lg" | "xl";
}) {
  const style = AVATAR_SIZE[size];
  const letter = host
    ?.replace(/^www\./, "")
    .charAt(0)
    .toLocaleUpperCase("en-US");
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-hover text-muted-foreground",
        style.box,
        style.type,
      )}
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {letter === undefined || letter === "" ? "?" : letter}
    </span>
  );
}

/**
 * Commit State as a quiet dot-and-word instead of a filled pill. The word
 * stays on the two text colors (muted for the boring "saved" default,
 * foreground for the recovered states); the hue rides the dot alone, with
 * the plain-language tooltip.
 */
export function StateWord({
  state,
  focusable = false,
}: {
  readonly state: CommitState;
  /** Give the word its own tab stop (for the tooltip). Leave it off inside a
   *  focusable table row: the row is the tab stop, and its sheet carries the
   *  explanation. @default false */
  readonly focusable?: boolean;
}) {
  const size = useSize();
  const meta = COMMIT_META[state];
  return (
    <TermTooltip
      content={
        <TermExplanation technical={meta.technical}>
          {meta.plain}
        </TermExplanation>
      }
    >
      <span
        tabIndex={focusable ? 0 : undefined}
        className={cn(
          "inline-flex cursor-help items-center gap-1.5 whitespace-nowrap rounded-sm",
          focusable &&
            "outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
          size.type.caption,
          state === "committed" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        <EvidenceDot state={meta.badge} />
        {meta.label}
      </span>
    </TermTooltip>
  );
}
