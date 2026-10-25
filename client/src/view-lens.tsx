/**
 * The topbar's lens chip: the Case-wide date range and profile pick the
 * page on show applies, in words, with a clear button. It shows only what
 * the page filters by (its registry entry, `PAGES[page].lens`), so a page
 * that ignores the range never looks filtered; and nothing at all when no
 * lens is set.
 */
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { CalendarIcon, CloseIcon } from "@/lib/app-icons";
import { spring } from "@/lib/springs";
import { typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { profileLabel } from "./components/finding-fields.js";
import { formatCaseDay } from "./related.js";
import { PAGES } from "./pages.js";
import { useViewLocation, useViewState } from "./view-state.js";

/** Which parts of the lens the page on show applies. */
function useLensApplied(): {
  readonly range: boolean;
  readonly profiles: boolean;
} {
  const { lens } = PAGES[useViewLocation().page];
  return { range: lens.range !== null, profiles: lens.profiles };
}

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
  /** After the lens is cleared, with what is shown now (the shell
   *  announces it). */
  readonly onClear?: (message: string) => void;
}) {
  const { clear, range, profiles, setProfiles } = useViewState();
  const lens = useLensApplied();
  const { page } = useViewLocation();
  const pageLabel = PAGES[page].label;
  const parts = useLensParts();
  // A page that applies the range shows it on its own date picker (the
  // same days, with its own clear), so it does not get them twice: the
  // chip then carries only what the picker does not.
  const rangeOnPage = lens.range;
  const rangeWords = rangeLabel(range.from, range.to);
  const applied = rangeOnPage
    ? parts.applied.filter((part) => part !== rangeWords)
    : parts.applied;
  const { unapplied } = parts;
  const appliedText = applied.join(" · ");
  const unappliedText = unapplied.join(" · ");
  const all = [...applied, ...unapplied].join(" · ");
  // Each part in words, with what it filters by or why it does not: "13
  // Mar 2024, by start time", "Cookies does not filter by date".
  const rangeText = rangeLabel(range.from, range.to);
  const profileText = profilesLabel(profiles);
  const field = PAGES[page].lens.range;
  const sentences = [
    rangeText === null
      ? null
      : lens.range
        ? `Showing ${rangeText}${field === null ? "" : `, by ${field}`}.`
        : `${rangeText} is not applied: ${pageLabel} does not filter by date.`,
    profileText === null
      ? null
      : lens.profiles
        ? `Showing ${profileText}.`
        : `${profileText} is not applied: ${pageLabel} does not filter by profile.`,
  ].filter((sentence): sentence is string => sentence !== null);
  const label = sentences.join(" ");
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
                Not applied on {pageLabel}: {unappliedText}
              </span>
            )}
          </span>
          <Button
            variant="ghost"
            size="icon-compact"
            className="coarse-hit size-6 shrink-0"
            aria-label={`Clear ${all}`}
            title={
              rangeOnPage
                ? "Show every profile"
                : "Show every day and every profile"
            }
            onClick={() => {
              if (rangeOnPage) {
                // The range stays with the page's picker.
                setProfiles([]);
                onClear?.("Showing every profile");
              } else {
                clear();
                onClear?.("Showing every day and every profile");
              }
            }}
          >
            <CloseIcon />
          </Button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
