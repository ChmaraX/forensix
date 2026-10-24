/**
 * Shared readers and small renderers for curated Finding views (Timeline,
 * Top sites, Sites). These never invent data: a missing or non-value field
 * reads as `null` and renders as the word "absent" at the call site.
 */
import { fontWeights } from "@/lib/font-weight";
import { typeClass, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { COMMIT_META } from "../terms.js";
import type { CommitState, FieldState } from "../types.js";
import { EvidenceDot } from "./evidence.js";
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
export function StateWord({ state }: { readonly state: CommitState }) {
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
        tabIndex={0}
        className={cn(
          "inline-flex cursor-help items-center gap-1.5 whitespace-nowrap rounded-sm outline-none focus-visible:ring-1 focus-visible:ring-[color:var(--focus-ring,#6B97FF)]",
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
