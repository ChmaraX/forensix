/**
 * The range control shared by every chart: a single trigger that reads as a
 * sentence ("12 Jan 2024 — 3 Mar 2024") and opens a calendar on an FF popover
 * surface, rather than two bare native date inputs sitting side by side.
 * Selection is bounded to the Case's recorded span — a day outside it is not a
 * valid range regardless of what the OS date picker would allow — and the
 * trigger carries its own clear affordance once a range is set.
 *
 * The FF layer:
 *  - the trigger is drawn like an FF Select trigger (bordered, `bg-hover` on
 *    hover, the icon thickening 1.5 → 2) and follows the size ladder, so it is
 *    28px inside a compact toolbar and 36px elsewhere;
 *  - the calendar (react-day-picker) sits on `PopoverContent`, Elevated two
 *    steps above whatever it opens from;
 *  - days share one fluid hover highlight per month (`useFluidHover`, axis
 *    `xy`), so the fill glides to the day nearest the pointer instead of
 *    blinking per cell;
 *  - the range ends are solid pills that travel to a newly picked day on
 *    `spring.moderate` (shared layout ids), with the days between on a
 *    continuous `bg-active` band;
 *  - type comes from the FF roles and weights; disabled days fade like any
 *    disabled FF control.
 *  - optional range presets (`presets`) as a fluid-hover rail beside the grid.
 */
import { LayoutGroup, motion } from "motion/react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type RefObject,
} from "react";
import {
  DayPicker,
  type DateRange,
  type DayButtonProps,
  type DayProps,
  type MonthProps,
} from "react-day-picker";

import { FluidHoverHighlight } from "@/components/fluid-hover-highlight";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  useFluidHover,
  useRegisterFluidHoverItem,
  type UseFluidHoverReturn,
} from "@/hooks/use-fluid-hover";
import {
  CalendarIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
} from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { typeClass, useSize } from "@/lib/size-context";
import { spring } from "@/lib/springs";
import { cn } from "@/lib/utils";

/**
 * A two-month grid (each ~260px wide) does not fit a phone-width viewport.
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

function shiftIsoDate(value: string, days: number): string {
  const parsed = parseIsoDate(value);
  if (parsed === undefined) {
    return value;
  }
  return toIsoDate(new Date(parsed.getTime() + days * 86_400_000));
}

function spanDays(from: string, to: string): number {
  return (
    Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() -
        new Date(`${from}T00:00:00Z`).getTime()) /
        86_400_000,
    ) + 1
  );
}

/* ─────────────────────────────── Presets ─────────────────────────────── */

/** One quick range in the picker's preset rail. `from`/`to` are ISO dates;
 *  both `""` means the full recorded span (the cleared range). */
interface DateRangePreset {
  readonly label: string;
  readonly from: string;
  readonly to: string;
}

/**
 * The default presets: the last 7 / 30 / 90 days *of the recorded span*
 * (ending on its last recorded day, never on today — the Case's evidence does
 * not reach today), plus the full span. A preset as long as the span itself is
 * left out.
 */
function spanPresets(
  min: string | null,
  max: string | null,
): readonly DateRangePreset[] {
  const full: DateRangePreset = { label: "Full span", from: "", to: "" };
  if (min === null || max === null || min === "" || max === "") {
    return [full];
  }
  const total = spanDays(min, max);
  const windows = [7, 30, 90]
    .filter((days) => days < total)
    .map((days) => ({
      label: `Last ${String(days)} days`,
      from: shiftIsoDate(max, -(days - 1)),
      to: max,
    }));
  return [...windows, full];
}

/* ─────────────────────────── Calendar parts ─────────────────────────── */

const CALENDAR_CLASS_NAMES = {
  root: "relative p-3",
  months: "flex flex-col gap-4 sm:flex-row sm:gap-6",
  month: "flex flex-col gap-2",
  month_caption: "flex h-7 items-center justify-center px-8",
  caption_label: cn(
    typeClass("body"),
    "pointer-events-none inline-flex items-center gap-0.5 text-foreground",
  ),
  nav: "pointer-events-none absolute inset-x-3 top-3 flex items-center justify-between",
  button_previous: "pointer-events-auto",
  button_next: "pointer-events-auto",
  month_grid: "w-full border-collapse",
  weekdays: "flex",
  weekday: cn(
    typeClass("caption"),
    "h-7 w-9 text-center text-muted-foreground pointer-coarse:w-11",
  ),
  weeks: "flex flex-col gap-1",
  week: "flex w-full",
  day: "relative size-9 p-0 text-center align-middle pointer-coarse:size-11",
  day_button: "",
  today: "",
  outside: "",
  disabled: "",
  hidden: "invisible",
  range_start: "",
  range_end: "",
  range_middle: "",
  selected: "",
  // Month + year quick-jump: a Case spanning years would otherwise need one
  // chevron click per month to reach an old date. The dropdown's real
  // `<select>` sits invisible over the visible caption label (react-day-
  // picker's own composition, see its `Dropdown` component) so it stays a
  // native, keyboard- and screen-reader-usable control despite reading as
  // plain text.
  dropdowns: "flex items-center justify-center gap-0.5",
  dropdown_root:
    "relative inline-flex h-7 items-center rounded-lg px-1.5 transition-colors duration-80 hover:bg-hover has-[:focus-visible]:ring-1 has-[:focus-visible]:ring-focus-ring",
  dropdown: "absolute inset-0 z-10 cursor-pointer opacity-0",
} as const;

function CalendarChevron({
  className,
  orientation,
}: {
  readonly className?: string;
  readonly orientation?: "up" | "down" | "left" | "right";
}) {
  const Icon =
    orientation === "right"
      ? ChevronRightIcon
      : orientation === "down"
        ? ChevronDownIcon
        : ChevronLeftIcon;
  return (
    <Icon
      strokeWidth={1.5}
      className={cn(
        orientation === "down" ? "size-3.5 text-muted-foreground" : "size-4",
        className,
      )}
    />
  );
}

function CalendarNavButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      variant="ghost"
      size="icon-compact"
      className={className}
      {...props}
    >
      {children}
    </Button>
  );
}

const MonthHoverContext = createContext<UseFluidHoverReturn | null>(null);
/** Shared layout ids for the travelling range-end pills, per picker. */
const PickerIdContext = createContext("range");

function isDisabledDay(element: HTMLElement): boolean {
  return (element as HTMLButtonElement).disabled;
}

/** One month: the fluid hover container for its days. */
function CalendarMonth(monthProps: MonthProps) {
  // `calendarMonth` / `displayIndex` are react-day-picker's own data; only
  // the div attributes reach the DOM.
  const {
    calendarMonth: _month,
    displayIndex: _index,
    className,
    children,
    ...props
  } = monthProps;
  void _month;
  void _index;
  const ref = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(ref, {
    axis: "xy",
    isItemDisabled: isDisabledDay,
    gapClick: false,
  });
  return (
    <div ref={ref} className={cn(className, "relative")} {...props}>
      <FluidHoverHighlight hover={hover} className="rounded-lg" />
      <MonthHoverContext.Provider value={hover}>
        {children}
      </MonthHoverContext.Provider>
    </div>
  );
}

/** The day grid: pointer moves over it drive the month's highlight (the
 *  caption above stays out of it, so hovering the month name lights no day). */
function CalendarMonthGrid(props: HTMLAttributes<HTMLTableElement>) {
  const hover = useContext(MonthHoverContext);
  return (
    <table
      {...props}
      onMouseMove={hover?.handlers.onMouseMove}
      onMouseEnter={hover?.handlers.onMouseEnter}
      onMouseLeave={hover?.handlers.onMouseLeave}
    />
  );
}

/** A day cell: draws the continuous band under the days inside a range. */
function CalendarDay({
  day,
  modifiers,
  className,
  children,
  ...props
}: DayProps) {
  const band = modifiers["range_middle"]
    ? "full"
    : modifiers["range_start"] && !modifiers["range_end"]
      ? "end-half"
      : modifiers["range_end"] && !modifiers["range_start"]
        ? "start-half"
        : null;
  const weekday = day.date.getDay();
  const dayOfMonth = day.date.getDate();
  const lastOfMonth = new Date(day.date.getTime() + 86_400_000).getDate() === 1;
  return (
    <td className={className} {...props}>
      {band === null ? null : (
        <span
          aria-hidden="true"
          className={cn(
            "absolute inset-y-0 bg-active",
            band === "full" && "inset-x-0",
            band === "end-half" && "right-0 left-1/2",
            band === "start-half" && "right-1/2 left-0",
            band === "full" &&
              (weekday === 0 || dayOfMonth === 1) &&
              "rounded-l-lg",
            band === "full" && (weekday === 6 || lastOfMonth) && "rounded-r-lg",
          )}
        />
      )}
      {children}
    </td>
  );
}

/** A day button: joins the month's fluid hover, and draws the range-end pill
 *  that travels on `spring.moderate` when a new end is picked. */
function CalendarDayButton({
  day,
  modifiers,
  className,
  children,
  ...props
}: DayButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const hover = useContext(MonthHoverContext);
  const pickerId = useContext(PickerIdContext);
  const focused = modifiers["focused"] === true;
  useEffect(() => {
    if (focused) {
      ref.current?.focus();
    }
  }, [focused]);
  useRegisterFluidHoverItem(
    hover?.registerItem,
    day.outside ? undefined : day.date.getDate() - 1,
    ref as RefObject<HTMLElement | null>,
  );
  const start = modifiers["range_start"] === true;
  const end = modifiers["range_end"] === true;
  const middle = modifiers["range_middle"] === true;
  const loneSelected =
    modifiers["selected"] === true && !start && !end && !middle;
  const endpoint = start || end || loneSelected;
  const strong = endpoint || modifiers["today"] === true;
  return (
    <button
      ref={ref}
      className={cn(
        className,
        typeClass("body"),
        "relative inline-flex size-9 cursor-pointer items-center justify-center rounded-lg tabular-nums outline-none transition-colors duration-80 pointer-coarse:size-11",
        "focus-visible:ring-1 focus-visible:ring-focus-ring",
        "disabled:cursor-default disabled:opacity-50",
        endpoint ? "text-background" : "text-foreground",
        modifiers["disabled"] === true && "text-muted-foreground",
      )}
      {...props}
    >
      {start || loneSelected ? (
        <motion.span
          layoutId={`${pickerId}-start`}
          transition={spring.moderate}
          aria-hidden="true"
          className="absolute inset-0 rounded-lg bg-foreground"
        />
      ) : null}
      {end && !start ? (
        <motion.span
          layoutId={`${pickerId}-end`}
          transition={spring.moderate}
          aria-hidden="true"
          className="absolute inset-0 rounded-lg bg-foreground"
        />
      ) : null}
      <span
        className="relative"
        style={{
          fontVariationSettings: strong
            ? fontWeights.semibold
            : fontWeights.normal,
        }}
      >
        {children}
      </span>
      {modifiers["today"] === true ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full",
            endpoint ? "bg-background" : "bg-foreground",
          )}
        />
      ) : null}
    </button>
  );
}

/* ──────────────────────────── Preset rail ──────────────────────────── */

function PresetRail({
  presets,
  from,
  to,
  onPick,
}: {
  readonly presets: readonly DateRangePreset[];
  readonly from: string;
  readonly to: string;
  readonly onPick: (preset: DateRangePreset) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const hover = useFluidHover(ref, { axis: "xy" });
  return (
    <div
      ref={ref}
      role="group"
      aria-label="Quick ranges"
      {...hover.handlers}
      className="relative flex flex-wrap gap-0.5 border-b border-border p-2 sm:w-36 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0"
    >
      <FluidHoverHighlight hover={hover} className="rounded-lg" />
      {presets.map((preset, index) => (
        <PresetItem
          key={preset.label}
          index={index}
          preset={preset}
          selected={preset.from === from && preset.to === to}
          registerItem={hover.registerItem}
          onPick={onPick}
        />
      ))}
    </div>
  );
}

function PresetItem({
  index,
  preset,
  selected,
  registerItem,
  onPick,
}: {
  readonly index: number;
  readonly preset: DateRangePreset;
  readonly selected: boolean;
  readonly registerItem: UseFluidHoverReturn["registerItem"];
  readonly onPick: (preset: DateRangePreset) => void;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useRegisterFluidHoverItem(registerItem, index, ref);
  return (
    <button
      ref={ref}
      type="button"
      aria-pressed={selected}
      onClick={() => {
        onPick(preset);
      }}
      className={cn(
        typeClass("body", "compact"),
        "relative inline-flex h-7 cursor-pointer items-center rounded-lg px-2 text-left whitespace-nowrap outline-none focus-visible:ring-1 focus-visible:ring-focus-ring",
        selected ? "bg-active text-foreground" : "text-muted-foreground",
        "transition-colors duration-80 hover:text-foreground",
      )}
    >
      {/* Ghost span: the semibold copy reserves the width, so a pick never
          shifts the rail. */}
      <span className="inline-grid">
        <span
          className="col-start-1 row-start-1 transition-[color,font-variation-settings] duration-80"
          style={{
            fontVariationSettings: selected
              ? fontWeights.semibold
              : fontWeights.normal,
          }}
        >
          {preset.label}
        </span>
        <span
          aria-hidden="true"
          className="invisible col-start-1 row-start-1"
          style={{ fontVariationSettings: fontWeights.semibold }}
        >
          {preset.label}
        </span>
      </span>
    </button>
  );
}

/* ─────────────────────────────── Picker ─────────────────────────────── */

export function DateRangePicker({
  from,
  to,
  min,
  max,
  triggerLabel,
  formatDate,
  onChange,
  className,
  presets,
  size,
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
  /** Extra classes for the trigger group — lets a host surface size and
   *  place the control without forking it. */
  readonly className?: string;
  /** Optional quick ranges in a rail beside the calendar. `true` uses
   *  `spanPresets(min, max)` (last 7 / 30 / 90 recorded days + full span);
   *  an array supplies your own. Omitted, no rail (the original layout). */
  readonly presets?: boolean | readonly DateRangePreset[];
  /** Optional size-ladder step for the trigger (36px / 28px). Omitted, it
   *  follows the surrounding SizeProvider (compact in a ChartSection). */
  readonly size?: "default" | "compact";
}) {
  const sizeClasses = useSize(size);
  const shape = useShape();
  const pickerId = useId();
  const [open, setOpen] = useState(false);
  const selected: DateRange | undefined =
    from === "" && to === ""
      ? undefined
      : { from: parseIsoDate(from), to: parseIsoDate(to) };
  const minDate = parseIsoDate(min ?? "");
  const maxDate = parseIsoDate(max ?? "");
  const active = from !== "" || to !== "";
  const numberOfMonths = useNumberOfMonths();
  const presetList = useMemo(
    () =>
      presets === undefined || presets === false
        ? null
        : presets === true
          ? spanPresets(min, max)
          : presets,
    [max, min, presets],
  );

  return (
    <div
      role="group"
      aria-label="Date range"
      className={cn(
        "inline-flex max-w-full items-center border border-border bg-transparent transition-colors duration-80 has-[button:hover]:bg-hover",
        sizeClasses.control,
        sizeClasses.text,
        shape.input,
        active ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          {/* The trigger fills the whole control (minus the clear button), so
              anywhere on it opens the calendar — not just the label text. */}
          <button
            type="button"
            className={cn(
              "group inline-flex h-full min-w-0 cursor-pointer items-center rounded-[inherit] outline-none focus-visible:ring-1 focus-visible:ring-focus-ring",
              sizeClasses.gap,
              sizeClasses.px,
              active && "pr-1",
            )}
          >
            <CalendarIcon
              size={sizeClasses.icon}
              strokeWidth={1.5}
              className="shrink-0 text-muted-foreground transition-[color,stroke-width] duration-80 group-hover:text-foreground group-hover:[stroke-width:2]"
            />
            <span className="truncate tabular-nums">
              {active
                ? `${from === "" ? "…" : formatDate(from)} — ${to === "" ? "…" : formatDate(to)}`
                : triggerLabel}
            </span>
            {active ? null : (
              <ChevronDownIcon
                size={sizeClasses.icon}
                strokeWidth={1.5}
                className="shrink-0 text-muted-foreground transition-colors duration-80 group-hover:text-foreground"
              />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          flush
          align="end"
          // Focus lands on the calendar's selected day (or the last recorded
          // one) rather than the month dropdown, so arrow keys pick days
          // straight away.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
          }}
          className="w-auto max-w-[calc(100vw-2rem)] overflow-x-auto"
        >
          <div className="flex flex-col sm:flex-row">
            {presetList === null ? null : (
              <PresetRail
                presets={presetList}
                from={from}
                to={to}
                onPick={(preset) => {
                  onChange({ from: preset.from, to: preset.to });
                  setOpen(false);
                }}
              />
            )}
            <PickerIdContext.Provider value={pickerId}>
              <LayoutGroup id={pickerId}>
                <DayPicker
                  mode="range"
                  autoFocus
                  timeZone="UTC"
                  captionLayout="dropdown"
                  numberOfMonths={numberOfMonths}
                  defaultMonth={
                    parseIsoDate(to) ?? parseIsoDate(from) ?? maxDate
                  }
                  startMonth={minDate}
                  endMonth={maxDate}
                  disabled={
                    minDate === undefined && maxDate === undefined
                      ? undefined
                      : [
                          ...(minDate === undefined
                            ? []
                            : [{ before: minDate }]),
                          ...(maxDate === undefined
                            ? []
                            : [{ after: maxDate }]),
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
                  components={{
                    Chevron: CalendarChevron,
                    PreviousMonthButton: CalendarNavButton,
                    NextMonthButton: CalendarNavButton,
                    Month: CalendarMonth,
                    MonthGrid: CalendarMonthGrid,
                    Day: CalendarDay,
                    DayButton: CalendarDayButton,
                  }}
                />
              </LayoutGroup>
            </PickerIdContext.Provider>
          </div>
          {active ? (
            <div className="flex items-center justify-between gap-3 border-t border-border py-1.5 pr-1.5 pl-4">
              <p
                className={cn(
                  typeClass("caption"),
                  "text-muted-foreground tabular-nums",
                )}
              >
                {from === "" || to === ""
                  ? "Pick an end date"
                  : `${String(spanDays(from, to))} days selected`}
              </p>
              <Button
                variant="ghost"
                size="compact"
                onClick={() => {
                  onChange({ from: "", to: "" });
                }}
              >
                Reset to full span
              </Button>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {active ? (
        // FF's ghost icon button, a step under the 28px ladder so it sits
        // inside the bordered control without touching its hairline.
        <Button
          variant="ghost"
          size="icon-compact"
          aria-label="Clear date range"
          onClick={() => {
            onChange({ from: "", to: "" });
          }}
          className="mr-0.5 h-6 w-6"
        >
          <CloseIcon />
        </Button>
      ) : null}
    </div>
  );
}
