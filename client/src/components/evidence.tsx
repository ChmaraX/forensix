/**
 * Evidence-state marks, on FF's Badge.
 *
 * Forensic rule: a state is always a word — value, (empty), absent,
 * unavailable, saved, recovered — and color only ever repeats it. FF's dot
 * Badge is exactly that shape: a neutral outline, foreground text, and the
 * hue on the dot alone. Every state maps to one Badge color, the same hue
 * family as its theme token (--success, --destructive, --wal, --violet,
 * --warning in app.css):
 *
 *   produced / value  → green     unavailable / error → red
 *   wal (recovered — unsaved)     → amber
 *   journal (recovered — overwritten) → violet
 *   warning           → amber     absent / empty / committed → gray
 *   neutral           → a hollow ring: a plain label that is no evidence
 *                       state ("Complete", "Primary", "Backup")
 */
import type { ComponentProps, ReactNode } from "react";

import { Badge, type BadgeColor } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type EvidenceState =
  | "produced"
  | "unavailable"
  | "absent"
  | "empty"
  | "committed"
  | "wal"
  | "journal"
  | "warning"
  | "neutral";

const EVIDENCE_BADGE_COLOR: Readonly<Record<EvidenceState, BadgeColor>> = {
  produced: "green",
  unavailable: "red",
  absent: "gray",
  empty: "gray",
  committed: "gray",
  wal: "amber",
  journal: "violet",
  warning: "amber",
  neutral: "gray",
};

/** Tailwind background class for a bare state dot (theme tokens). */
const EVIDENCE_DOT_CLASS: Readonly<Record<EvidenceState, string>> = {
  produced: "bg-success",
  unavailable: "bg-destructive",
  absent: "bg-muted-foreground",
  empty: "bg-muted-foreground",
  committed: "bg-muted-foreground",
  wal: "bg-wal",
  journal: "bg-violet",
  warning: "bg-warning",
  neutral: "shadow-[inset_0_0_0_1px_var(--muted-foreground)]",
};

interface EvidenceBadgeProps extends Omit<
  ComponentProps<typeof Badge>,
  "color" | "children"
> {
  readonly state: EvidenceState;
  /** The state word. Required: color never stands in for it. */
  readonly children: ReactNode;
}

/** A state word in an FF Badge: `dot` by default, `solid` for a tinted chip. */
export function EvidenceBadge({
  state,
  variant = "dot",
  children,
  ...props
}: EvidenceBadgeProps) {
  return (
    <Badge variant={variant} color={EVIDENCE_BADGE_COLOR[state]} {...props}>
      {children}
    </Badge>
  );
}

/** A 6px state dot to sit beside a state word in running text or a cell. */
export function EvidenceDot({
  state,
  className,
}: {
  readonly state: EvidenceState;
  readonly className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block size-1.5 shrink-0 rounded-full",
        EVIDENCE_DOT_CLASS[state],
        className,
      )}
    />
  );
}
