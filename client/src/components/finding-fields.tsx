/**
 * Shared readers and small renderers for curated Finding views (Timeline,
 * Top sites, Sites). These never invent data: a missing or non-value field
 * reads as `null` and renders as the word "absent" at the call site.
 */
import { cn } from "../lib.js";
import { COMMIT_META } from "../terms.js";
import type { CommitState, FieldState } from "../types.js";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip.js";

/** `"value"`-state non-empty string, or null. */
export function fieldText(field: FieldState | undefined): string | null {
  if (field === undefined || field.state !== "value") {
    return null;
  }
  return typeof field.value === "string" && field.value !== ""
    ? field.value
    : null;
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

export function AbsentWord() {
  return (
    <span className="text-[12.5px] text-muted-foreground italic">absent</span>
  );
}

/** Neutral letter tile standing in for a favicon; identity is the text. */
export function SiteAvatar({
  host,
  size = "md",
}: {
  readonly host: string | null;
  readonly size?: "md" | "lg" | "xl";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md bg-muted font-semibold text-foreground/60 uppercase",
        size === "xl"
          ? "size-13 text-[20px]"
          : size === "lg"
            ? "size-10 text-[16px]"
            : "size-7 text-[12px]",
      )}
    >
      {host?.replace(/^www\./, "").charAt(0) ?? "?"}
    </span>
  );
}

/**
 * Commit State as a quiet dot-and-word instead of a filled pill: "saved" is
 * the boring default and sits muted; the two recovered states keep their own
 * hue on the dot and the word, with the existing plain-language tooltip.
 */
export function StateWord({ state }: { readonly state: CommitState }) {
  const meta = COMMIT_META[state];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex cursor-help items-center gap-1.5 text-[12px] whitespace-nowrap",
            state === "committed"
              ? "text-muted-foreground"
              : state === "wal_resident"
                ? "font-medium text-wal"
                : "font-medium text-violet",
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              "size-1.5 rounded-full",
              state === "committed"
                ? "bg-muted-foreground/50"
                : state === "wal_resident"
                  ? "bg-wal"
                  : "bg-violet",
            )}
          />
          {meta.label}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {meta.plain}
        <span className="mt-1 block font-mono text-[11px] opacity-70">
          {meta.technical}
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
