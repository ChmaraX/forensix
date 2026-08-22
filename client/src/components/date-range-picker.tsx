/**
 * The Overview range control: a single trigger that reads as a sentence
 * ("12 Jan 2024 — 3 Mar 2024") and opens a two-month calendar, rather than two
 * bare native date inputs sitting side by side. Selection is bounded to the
 * Case's recorded span — a day outside it is not a valid range regardless of
 * what the OS date picker would allow — and the trigger, not a separate
 * button, doubles as the clear affordance once a range is set.
 */
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { DayPicker, type DateRange } from "react-day-picker";

import { cn } from "../lib.js";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.js";

/**
 * A two-month grid (each ~230px wide) does not fit a phone-width viewport.
 * Below the app's existing `sm` breakpoint (640px) the picker drops to one
 * month, matching the overview grid's own responsive steps rather than
 * inventing a new breakpoint.
 */
function useNumberOfMonths(): 1 | 2 {
  const [count, setCount] = useState<1 | 2>(() =>
    globalThis.matchMedia("(min-width: 640px)").matches ? 2 : 1,
  );
  useEffect(() => {
    const query = globalThis.matchMedia("(min-width: 640px)");
    const onChange = () => {
      setCount(query.matches ? 2 : 1);
    };
    query.addEventListener("change", onChange);
    return () => {
      query.removeEventListener("change", onChange);
    };
  }, []);
  return count;
}

function parseIsoDate(value: string): Date | undefined {
  if (value === "") {
    return undefined;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toIsoDate(date: Date | undefined): string {
  return date === undefined ? "" : date.toISOString().slice(0, 10);
}

const CALENDAR_CLASS_NAMES = {
  root: "p-3",
  months: "flex flex-col gap-4 sm:flex-row sm:gap-6",
  month: "flex flex-col gap-3",
  month_caption: "flex items-center justify-center px-8 pt-1",
  caption_label: "text-[13px] font-semibold tracking-[-0.01em]",
  nav: "flex items-center justify-between",
  button_previous:
    "absolute left-1 top-1 inline-flex size-10 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 sm:size-8",
  button_next:
    "absolute right-1 top-1 inline-flex size-10 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-30 sm:size-8",
  month_grid: "mt-1 w-full border-collapse",
  weekdays: "flex",
  weekday:
    "w-11 pb-1 text-center text-[10.5px] font-medium tracking-[0.04em] text-muted-foreground uppercase sm:w-9",
  week: "flex w-full",
  day: "relative size-11 p-0 text-center align-middle text-[12.5px] sm:size-9",
  day_button:
    "inline-flex size-11 cursor-pointer items-center justify-center rounded-md tabular-nums transition-colors duration-150 hover:bg-muted disabled:pointer-events-none disabled:text-muted-foreground/40 sm:size-9",
  today: "[&_button]:font-semibold [&_button]:text-primary",
  outside: "text-muted-foreground/50",
  disabled: "text-muted-foreground/30",
  hidden: "invisible",
  range_start: "[&_button]:bg-primary [&_button]:text-primary-foreground",
  range_end: "[&_button]:bg-primary [&_button]:text-primary-foreground",
  range_middle: "bg-accent [&_button]:rounded-none [&_button]:hover:bg-accent",
  selected: "[&_button]:bg-primary [&_button]:text-primary-foreground",
} as const;

function CalendarChevron({
  className,
  orientation,
}: {
  readonly className?: string;
  readonly orientation?: "up" | "down" | "left" | "right";
}) {
  const Icon = orientation === "right" ? ChevronRight : ChevronLeft;
  return <Icon aria-hidden="true" className={cn("size-4", className)} />;
}

export function DateRangePicker({
  from,
  to,
  min,
  max,
  triggerLabel,
  formatDate,
  onChange,
  className,
}: {
  /** ISO `YYYY-MM-DD`, or `""` when that bound is unset. */
  readonly from: string;
  readonly to: string;
  readonly min: string | null;
  readonly max: string | null;
  /** What the trigger button reads when no range is selected. */
  readonly triggerLabel: string;
  /** Renders an ISO date for the trigger label, matching how the rest of the
   *  page writes dates ("9 Dec 2024") rather than the raw ISO form. */
  readonly formatDate: (isoDate: string) => string;
  readonly onChange: (range: { from: string; to: string }) => void;
  /** Extra classes for the trigger group — lets a host surface (the Overview
   *  masthead) size and elevate the control without forking it. */
  readonly className?: string;
}) {
  const selected: DateRange | undefined =
    from === "" && to === ""
      ? undefined
      : { from: parseIsoDate(from), to: parseIsoDate(to) };
  const minDate = parseIsoDate(min ?? "");
  const maxDate = parseIsoDate(max ?? "");
  const active = from !== "" || to !== "";
  const numberOfMonths = useNumberOfMonths();

  return (
    <div
      role="group"
      aria-label="Date range"
      className={cn(
        "inline-flex h-9 items-center rounded-md border border-border bg-card text-[12.5px] transition-colors duration-150 has-[:hover]:border-muted-foreground/40",
        active ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <Popover>
        <PopoverTrigger asChild>
          {/* The trigger fills the whole pill (minus the clear button), so
              anywhere on it opens the calendar — not just the label text. */}
          <button
            type="button"
            className={cn(
              "inline-flex h-full cursor-pointer items-center gap-2 rounded-[inherit] pl-3",
              active ? "pr-1" : "pr-3",
            )}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className="size-3.5 shrink-0 text-muted-foreground"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="3" width="12" height="11" rx="1.5" />
              <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
            </svg>
            <span>
              {active
                ? `${from === "" ? "…" : formatDate(from)} — ${to === "" ? "…" : formatDate(to)}`
                : triggerLabel}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto max-w-[calc(100vw-2rem)] overflow-x-auto">
          <DayPicker
            mode="range"
            numberOfMonths={numberOfMonths}
            defaultMonth={maxDate}
            startMonth={minDate}
            endMonth={maxDate}
            disabled={
              minDate === undefined && maxDate === undefined
                ? undefined
                : [
                    ...(minDate === undefined ? [] : [{ before: minDate }]),
                    ...(maxDate === undefined ? [] : [{ after: maxDate }]),
                  ]
            }
            selected={selected}
            onSelect={(range) => {
              onChange({
                from: toIsoDate(range?.from),
                to: toIsoDate(range?.to),
              });
            }}
            classNames={CALENDAR_CLASS_NAMES}
            components={{ Chevron: CalendarChevron }}
          />
          {active ? (
            <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
              <p className="text-[12px] text-muted-foreground">
                {from === "" || to === ""
                  ? "Pick an end date"
                  : `${String(
                      Math.round(
                        (new Date(to).getTime() - new Date(from).getTime()) /
                          86_400_000,
                      ) + 1,
                    )} days selected`}
              </p>
              <button
                type="button"
                onClick={() => {
                  onChange({ from: "", to: "" });
                }}
                className="cursor-pointer text-[12px] font-medium text-primary hover:underline"
              >
                Reset to full span
              </button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {active ? (
        <button
          type="button"
          aria-label="Clear date range"
          onClick={() => {
            onChange({ from: "", to: "" });
          }}
          className="mr-2 inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-muted-foreground/70 transition-colors duration-150 hover:bg-muted hover:text-foreground"
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      ) : null}
    </div>
  );
}
