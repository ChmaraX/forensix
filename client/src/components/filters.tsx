/**
 * The filter toolbar: search, sort, direction, extras, limit, profiles.
 *
 * One compact region (`SizeProvider size="compact"`), so every control sits
 * on the 28px step and the gaps halve with it. Built from FF parts:
 *  - search and free-text extras: FF InputGroup + InputField (a hidden label
 *    keeps the accessible name; the placeholder carries the meaning);
 *  - sort, option extras and limit: FF Select;
 *  - direction: a ghost icon Button with a Tooltip naming the order;
 *  - profiles: a tertiary Button that opens an FF CheckboxGroup in a
 *    Popover (multi-pick; none picked means every Profile).
 *
 * Text fields commit on Enter or blur, as before; every other control
 * commits on pick.
 */
import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  ChevronDown,
  Search,
} from "lucide-react";
import { useId, useState, type ReactNode } from "react";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig } from "../types.js";
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
import { Tooltip } from "@/components/ui/tooltip";
import { SizeProvider, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";

export interface FilterState {
  readonly search: string;
  readonly sort: string;
  readonly direction: string;
  readonly limit: string;
  readonly extras: Readonly<Record<string, string>>;
  readonly profiles: readonly string[];
}

export function initialFilters(config: ArtifactConfig): FilterState {
  return {
    search: "",
    sort: config.sorts[0] ?? "",
    direction: (config.directions ?? ["desc", "asc"])[0] ?? "desc",
    limit: "25",
    extras: {},
    profiles: [],
  };
}

export function filterParameters(filters: FilterState): QueryParameters {
  const parameters: (readonly [string, string])[] = [
    ["search", filters.search.trim()],
    ["sort", filters.sort],
    ["direction", filters.direction],
    ["limit", filters.limit],
  ];
  for (const [name, value] of Object.entries(filters.extras)) {
    parameters.push([name, value.trim()]);
  }
  for (const profile of filters.profiles) {
    parameters.push(["profile", profile]);
  }
  return parameters;
}

/** FF Select items can't carry "", which the extras use for "all". */
const ALL_OPTION = "\u0000all";

const LIMITS = ["25", "50", "100"] as const;

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
 * A text field that commits on Enter or blur (FF InputGroup + InputField).
 * Exported for pages that need the same toolbar search.
 */
export function FilterTextField({
  id,
  label,
  value,
  placeholder,
  onCommit,
  icon,
  className,
}: {
  readonly id?: string;
  /** Accessible name (visually hidden). */
  readonly label: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly onCommit: (value: string) => void;
  /** Leading icon. Pass `Search` for a search field. */
  readonly icon?: typeof Search;
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
      className={cn("w-56 [&_label+div]:ring-border max-sm:w-full", className)}
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
        onChange={setDraft}
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
  const summary =
    selected.length === 0
      ? "All profiles"
      : selected.length === 1
        ? selected[0]
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
          trailingIcon={ChevronDown}
          className="max-sm:justify-between"
          aria-label={`Profiles: ${summary ?? "All profiles"}`}
        >
          {summary}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56">
        <CheckboxGroup checkedIndices={checked} aria-label="Profiles">
          {profiles.map((profile, index) => {
            const active = selected.includes(profile);
            return (
              <CheckboxItem
                key={profile}
                index={index}
                label={profile}
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
              Show every Profile
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function FilterBar({
  config,
  profiles,
  filters,
  onChange,
  className,
}: {
  readonly config: ArtifactConfig;
  readonly profiles: readonly string[];
  readonly filters: FilterState;
  readonly onChange: (filters: FilterState) => void;
  readonly className?: string;
}) {
  const directions = config.directions ?? ["desc", "asc"];
  const descending = filters.direction === "desc";
  const idBase = `${config.key}-${useId()}`;
  const DirectionIcon = descending ? ArrowDownWideNarrow : ArrowUpNarrowWide;

  return (
    <SizeProvider size="compact">
      <div
        role="group"
        aria-label={`Filter ${config.label}`}
        className={cn("flex flex-col gap-2", className)}
      >
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <FilterTextField
            id={`${idBase}-search`}
            label={`Search ${config.label.toLowerCase()}`}
            icon={Search}
            value={filters.search}
            placeholder={`Search ${config.label.toLowerCase()}…`}
            onCommit={(search) => {
              onChange({ ...filters, search });
            }}
            className="w-60 max-sm:w-full"
          />

          <FilterField label="Sort" htmlFor={`${idBase}-sort`}>
            <div className="flex items-center gap-1 max-sm:[&>*:first-child]:flex-1">
              <Select
                value={filters.sort}
                onValueChange={(sort) => {
                  onChange({ ...filters, sort });
                }}
              >
                <SelectTrigger
                  id={`${idBase}-sort`}
                  className="min-w-[140px]"
                />
                <SelectContent>
                  {config.sorts.map((sort, index) => (
                    <SelectItem key={sort} index={index} value={sort}>
                      {sort}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {directions.length > 1 ? (
                <Tooltip
                  content={
                    descending
                      ? "Descending — switch to ascending"
                      : "Ascending — switch to descending"
                  }
                >
                  <Button
                    variant="ghost"
                    size="icon-compact"
                    aria-label={
                      descending
                        ? "Sorted descending — switch to ascending"
                        : "Sorted ascending — switch to descending"
                    }
                    onClick={() => {
                      onChange({
                        ...filters,
                        direction: descending ? "asc" : "desc",
                      });
                    }}
                  >
                    <DirectionIcon />
                  </Button>
                </Tooltip>
              ) : null}
            </div>
          </FilterField>

          <FilterField label="Rows" htmlFor={`${idBase}-limit`}>
            <Select
              value={filters.limit}
              onValueChange={(limit) => {
                onChange({ ...filters, limit });
              }}
            >
              <SelectTrigger
                id={`${idBase}-limit`}
                aria-label="Rows per page"
                className="min-w-[72px]"
              />
              <SelectContent>
                {LIMITS.map((limit, index) => (
                  <SelectItem key={limit} index={index} value={limit}>
                    {limit}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FilterField>

          <FilterField label="Profiles" htmlFor={`${idBase}-profiles`}>
            <ProfilePicker
              id={`${idBase}-profiles`}
              profiles={profiles}
              selected={filters.profiles}
              onChange={(next) => {
                onChange({ ...filters, profiles: next });
              }}
            />
          </FilterField>
        </div>
        {config.extras.length === 0 ? null : (
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {config.extras.map((extra) => {
              const id = `${idBase}-${extra.parameter}`;
              const current = filters.extras[extra.parameter] ?? "";
              const commit = (value: string) => {
                onChange({
                  ...filters,
                  extras: { ...filters.extras, [extra.parameter]: value },
                });
              };
              return (
                <FilterField
                  key={extra.parameter}
                  label={extra.label}
                  htmlFor={id}
                >
                  {extra.options === undefined ? (
                    <FilterTextField
                      id={id}
                      label={extra.label}
                      value={current}
                      placeholder={extra.placeholder}
                      onCommit={commit}
                      className="w-40"
                    />
                  ) : (
                    <Select
                      value={current === "" ? ALL_OPTION : current}
                      onValueChange={(value) => {
                        commit(value === ALL_OPTION ? "" : value);
                      }}
                    >
                      <SelectTrigger id={id} />
                      <SelectContent>
                        {extra.options.map((option, index) => (
                          <SelectItem
                            key={option}
                            index={index}
                            value={option === "" ? ALL_OPTION : option}
                          >
                            {option === "" ? "all" : option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </FilterField>
              );
            })}
          </div>
        )}
      </div>
    </SizeProvider>
  );
}
