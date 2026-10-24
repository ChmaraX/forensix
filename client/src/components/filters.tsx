/**
 * Filter-bar fields, built from FF parts, that pages compose inside a
 * compact region (`Toolbar` from page-kit, or their own
 * `SizeProvider size="compact"`):
 *  - `FilterField`: a caption label beside its control (an FF Select, …);
 *  - `FilterTextField`: FF InputGroup + InputField (a hidden label keeps the
 *    accessible name; the placeholder carries the meaning), committing on
 *    Enter or blur;
 *  - `ProfilePicker`: a tertiary Button that opens an FF CheckboxGroup in a
 *    Popover (multi-pick; none picked means every Profile);
 *  - `SortSelect`: a list's order as one FF Select of worded orders
 *    ("Last used, newest"), asked of the server;
 *  - `CompactFilters`: on a phone, a toolbar's filter controls behind one
 *    "Filters (n)" button.
 */
import { Children, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CheckboxGroup, CheckboxItem } from "@/components/ui/checkbox-group";
import { InputField, InputGroup } from "@/components/ui/input-group";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { ChevronDownIcon, FilterIcon, type AppIcon } from "@/lib/app-icons";
import { SizeProvider, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { profileLabel } from "./finding-fields.js";
import { SM_UP, useMediaQuery } from "./use-media-query.js";

/**
 * A caption label beside its control, on one toolbar line. Below the `sm`
 * breakpoint the label takes a fixed column and the control stretches, so
 * a wrapped toolbar reads as an aligned form instead of a ragged row.
 */
export function FilterField({
  label,
  htmlFor,
  children,
  className,
}: {
  readonly label: ReactNode;
  readonly htmlFor?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  const size = useSize();
  return (
    <div className={cn("flex items-center gap-2 max-sm:w-full", className)}>
      <label
        htmlFor={htmlFor}
        className={cn(
          size.type.caption,
          "whitespace-nowrap text-muted-foreground max-sm:w-16 max-sm:shrink-0",
        )}
      >
        {label}
      </label>
      <div className="flex min-w-0 items-center gap-1 max-sm:flex-1 max-sm:[&>*:first-child]:min-w-0 max-sm:[&>*:first-child]:flex-1 max-sm:[&_[role=combobox]]:w-full">
        {children}
      </div>
    </div>
  );
}

/**
 * A toolbar text field (FF InputGroup + InputField), 240px wide (full width
 * on a phone). Two commit modes:
 *  - `commit="submit"` (default): commits on Enter or blur — for a field that
 *    drives a server query (History, Sites), so typing doesn't fire a read
 *    per keystroke;
 *  - `commit="change"`: commits on every keystroke — for a filter over rows
 *    already loaded in the page (Cookies, Bookmarks, Cache, …), which narrows
 *    live as you type.
 */
export function FilterTextField({
  id,
  label,
  value,
  placeholder,
  onCommit,
  commit = "submit",
  icon,
  className,
}: {
  readonly id?: string;
  /** Accessible name (visually hidden). */
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly onCommit: (value: string) => void;
  /** When `onCommit` fires: on Enter/blur (`"submit"`, server queries) or
   *  on every change (`"change"`, client-side filters). */
  readonly commit?: "submit" | "change";
  /** Leading icon. Pass `SearchIcon` (lib/app-icons) for a search field. */
  readonly icon?: AppIcon;
  readonly className?: string;
}) {
  const [draft, setDraft] = useState(value);
  // Follow an outside reset (e.g. a page switching config) without
  // clobbering typing in progress.
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <InputGroup
      // In a toolbar the field keeps its hairline at rest, like the Select
      // triggers beside it (FF's bare field ring only shows on hover).
      // Below `sm` it takes the rest of its row (beside a "Filters"
      // button), and a row of its own when there is no room.
      className={cn(
        "w-60 [&_label+div]:ring-border max-sm:w-auto max-sm:min-w-40 max-sm:flex-1",
        className,
      )}
      // InputField keeps its own focus state on the input's blur, so the
      // commit listens one level up (React's onBlur bubbles).
      onBlur={() => {
        if (draft !== value) {
          onCommit(draft);
        }
      }}
    >
      <InputField
        index={0}
        id={id}
        label={label}
        labelHidden
        icon={icon}
        value={draft}
        placeholder={placeholder}
        onChange={(next) => {
          setDraft(next);
          if (commit === "change") {
            setSeen(next);
            onCommit(next);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && draft !== value) {
            onCommit(draft);
          }
        }}
      />
    </InputGroup>
  );
}

/** Multi-pick Profiles: none picked reads (and queries) as every Profile. */
export function ProfilePicker({
  profiles,
  selected,
  onChange,
  id,
}: {
  readonly profiles: readonly string[];
  readonly selected: readonly string[];
  readonly onChange: (profiles: readonly string[]) => void;
  readonly id?: string;
}) {
  const size = useSize();
  if (profiles.length === 0) {
    return (
      <span className={cn(size.type.caption, "text-muted-foreground")}>
        No Profiles.
      </span>
    );
  }
  // One profile name everywhere (`profileLabel`): "Default profile",
  // "Profile 2", as the coverage detail and the row sheet write them.
  const [only] = selected;
  const summary =
    selected.length === 0
      ? "All profiles"
      : selected.length === 1 && only !== undefined
        ? profileLabel(only)
        : `${String(selected.length)} profiles`;
  const checked = new Set(
    profiles.flatMap((profile, index) =>
      selected.includes(profile) ? [index] : [],
    ),
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="tertiary"
          size="compact"
          trailingIcon={ChevronDownIcon}
          className="max-sm:justify-between"
          aria-label={`Profiles: ${summary}`}
        >
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56" aria-label="Profiles">
        <CheckboxGroup checkedIndices={checked} aria-label="Profiles">
          {profiles.map((profile, index) => {
            const active = selected.includes(profile);
            return (
              <CheckboxItem
                key={profile}
                index={index}
                label={profileLabel(profile)}
                checked={active}
                onToggle={() => {
                  onChange(
                    active
                      ? selected.filter((entry) => entry !== profile)
                      : [...selected, profile],
                  );
                }}
              />
            );
          })}
        </CheckboxGroup>
        {selected.length === 0 ? null : (
          <div className="mt-1 border-t border-border pt-1">
            <Button
              variant="ghost"
              size="compact"
              className="w-full justify-start"
              onClick={() => {
                onChange([]);
              }}
            >
              Show every profile
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/**
 * A toolbar's filter controls (sort, selects, the profile pick - not the
 * search field, which stays in the bar) as they fit the screen: inline from
 * `sm` up; below it, one tertiary "Filters" button ("Filters (2)" while two
 * of them narrow the list) opening the same controls stacked in an FF
 * popover, so a phone toolbar keeps two rows (the Saved / Recovered switch
 * with the button, then the search) instead of four. One pattern for every
 * list toolbar that would stack more than two rows on a phone.
 */
export function CompactFilters({
  active,
  children,
}: {
  /** How many of the controls narrow the list now (a sort does not). */
  readonly active: number;
  readonly children: ReactNode;
}) {
  const wide = useMediaQuery(SM_UP);
  if (wide) {
    return <>{children}</>;
  }
  // Nothing to filter by on this page now (one profile, no folders): no
  // button that opens an empty popover.
  if (Children.toArray(children).length === 0) {
    return null;
  }
  const words = active > 0 ? `Filters (${String(active)})` : "Filters";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="tertiary" size="compact" leadingIcon={FilterIcon}>
          {words}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={16}
        aria-label="Filters"
        className="w-[min(22rem,calc(100vw-2rem))]"
      >
        <SizeProvider size="compact">
          {/* The popover itself is named "Filters"; its controls carry
              their own labels. */}
          <div className="flex flex-col gap-3 p-2">{children}</div>
        </SizeProvider>
      </PopoverContent>
    </Popover>
  );
}

/** One worded order of a list: the route's `sort` and `direction`. */
export interface SortOption {
  /** "Last used, newest" - the order in words, the field first. */
  readonly label: string;
  readonly sort: string;
  readonly direction: "asc" | "desc";
}

/** The Select value of an order. */
export function sortKeyOf(option: SortOption): string {
  return `${option.sort}:${option.direction}`;
}

/**
 * A list's order: "Sort" beside one FF Select of worded orders (field and
 * direction together, "Created, oldest"), the first being the route's
 * default. The order is asked of the server (`sort` + `direction`), so a
 * paged list is in that order from its first row - never a re-sort of the
 * rows loaded so far.
 */
export function SortSelect({
  id,
  options,
  value,
  onChange,
}: {
  readonly id: string;
  readonly options: readonly SortOption[];
  /** `sortKeyOf` of the order in use. */
  readonly value: string;
  readonly onChange: (option: SortOption) => void;
}) {
  return (
    <FilterField label="Sort" htmlFor={id}>
      <Select
        value={value}
        onValueChange={(next) => {
          const option = options.find((entry) => sortKeyOf(entry) === next);
          if (option !== undefined) {
            onChange(option);
          }
        }}
      >
        <SelectTrigger id={id} className="min-w-[156px]" />
        <SelectContent>
          {options.map((option, index) => (
            <SelectItem
              key={sortKeyOf(option)}
              index={index}
              value={sortKeyOf(option)}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterField>
  );
}
