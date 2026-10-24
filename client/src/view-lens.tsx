/**
 * The topbar's lens chip: the Case-wide date range and profile pick the
 * page on show applies, in words, with a clear button. It shows only what
 * the page filters by (`useLensApplied`), so a page that ignores the range
 * never looks filtered; and nothing at all when no lens is set.
 */
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { CalendarIcon, CloseIcon } from "@/lib/app-icons";
import { spring } from "@/lib/springs";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { profileLabel } from "./components/finding-fields.js";
import { formatCaseDay } from "./related.js";
import { useLensApplied, useViewState } from "./view-state.js";

/** "12 Mar 2024", "12 - 14 Mar 2024", "12 Mar - 4 Apr 2024",
 *  "30 Dec 2023 - 2 Jan 2024", "From 12 Mar 2024". */
export function rangeLabel(from: string, to: string): string | null {
  if (from === "" && to === "") {
    return null;
  }
  if (from !== "" && to !== "") {
    if (from === to) {
      return formatCaseDay(from);
    }
    const [first = "", firstMonth = "", firstYear = ""] =
      formatCaseDay(from).split(" ");
    const last = formatCaseDay(to);
    const [, lastMonth = "", lastYear = ""] = last.split(" ");
    if (firstYear !== lastYear) {
      return `${formatCaseDay(from)} - ${last}`;
    }
    return firstMonth === lastMonth
      ? `${first} - ${last}`
      : `${first} ${firstMonth} - ${last}`;
  }
  return from !== ""
    ? `From ${formatCaseDay(from)}`
    : `Until ${formatCaseDay(to)}`;
}

/** "Default profile", "2 profiles". */
export function profilesLabel(profiles: readonly string[]): string | null {
  if (profiles.length === 0) {
    return null;
  }
  const [only] = profiles;
  return profiles.length === 1 && only !== undefined
    ? profileLabel(only)
    : `${String(profiles.length)} profiles`;
}

/** The lens in words: the parts the page on show applies, and the parts
 *  it does not (a page without a date filter, say). */
export function useLensParts(): {
  readonly applied: readonly string[];
  readonly unapplied: readonly string[];
} {
  const { range, profiles } = useViewState();
  const lens = useLensApplied();
  const parts = [
    [rangeLabel(range.from, range.to), lens.range],
    [profilesLabel(profiles), lens.profiles],
  ] as const;
  const words = (applied: boolean) =>
    parts.flatMap(([label, on]) =>
      label === null || on !== applied ? [] : [label],
    );
  return { applied: words(true), unapplied: words(false) };
}

/** The lens as the page applies it, in words, or null. */
export function useLensSummary(): string | null {
  const { applied } = useLensParts();
  return applied.length === 0 ? null : applied.join(" · ");
}

/**
 * The chip. Parts the page applies read in the foreground; parts it does
 * not (the range on Cookies) stay visible, muted, with "not applied here",
 * so the lens never looks lost and a page never looks filtered when it is
 * not.
 */
export function ViewLensChip({
  onClear,
}: {
  /** After the lens is cleared (the shell announces it). */
  readonly onClear?: () => void;
}) {
  const { clear } = useViewState();
  const { applied, unapplied } = useLensParts();
  const appliedText = applied.join(" · ");
  const unappliedText = unapplied.join(" · ");
  const all = [...applied, ...unapplied].join(" · ");
  const label =
    unapplied.length === 0
      ? `Showing ${appliedText}`
      : applied.length === 0
        ? `${unappliedText}, not applied on this page`
        : `Showing ${appliedText}; ${unappliedText} not applied on this page`;
  return (
    <AnimatePresence initial={false}>
      {all === "" ? null : (
        <motion.div
          key="lens"
          role="group"
          aria-label={label}
          title={label}
          className={cn(
            typeClass("caption"),
            "flex h-7 min-w-0 items-center gap-1.5 rounded-lg pr-0.5 pl-2 ring-1 ring-border ring-inset",
          )}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96, transition: spring.fast.exit }}
          transition={spring.fast}
        >
          <CalendarIcon
            size={14}
            strokeWidth={1.5}
            className="shrink-0 text-muted-foreground"
          />
          <span className="min-w-0 truncate tabular-nums" aria-hidden="true">
            {appliedText === "" ? null : (
              <span className="text-foreground">{appliedText}</span>
            )}
            {/* The qualifier leads, so a narrow topbar truncates the date,
                never the "not applied". */}
            {unappliedText === "" ? null : (
              <span className="text-muted-foreground">
                {appliedText === "" ? "" : " · "}
                Not applied here: {unappliedText}
              </span>
            )}
          </span>
          <Button
            variant="ghost"
            size="icon-compact"
            className="size-6 shrink-0"
            aria-label={`Clear ${all}`}
            title="Show every day and every profile"
            onClick={() => {
              clear();
              onClear?.();
            }}
          >
            <CloseIcon />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
