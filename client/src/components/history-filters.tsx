/**
 * History's visit filters: the parameters both visit lists read (sort,
 * direction, "Arrived via", the Case-wide range and profile pick, the
 * search) - each a real `queryHistory` parameter, never a narrowing of a
 * loaded page - their place in the URL, and the toolbar that sets them.
 */
import { useCallback, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { SearchIcon, SortNewestIcon, SortOldestIcon } from "@/lib/app-icons";

import type { QueryParameters } from "../api.js";
import type { RowLookupSource } from "../row-lookup.js";
import {
  updateView,
  useViewProfiles,
  useViewRange,
  useViewSearch,
} from "../view-state.js";
import { dayRangeParameters } from "./day-bounds.js";
import {
  CompactFilters,
  FilterField,
  FilterTextField,
  ProfilePicker,
} from "./filters.js";
import { formatDay, formatDaySpan } from "./page-kit.js";

/** How many visit rows each list loads per request. */
const VISITS_PAGE_LIMIT = 100;

/** The filters the visit lists and their queries both read — every one of
 *  them a real server-side parameter `queryHistory` already accepts, not a
 *  client-side narrowing of an already-loaded page. */
export interface VisitFilters {
  readonly search: string;
  readonly sort: string;
  readonly direction: "asc" | "desc";
  readonly transition: string;
  readonly from: string;
  readonly to: string;
  readonly profiles: readonly string[];
}

export const DEFAULT_VISIT_FILTERS: VisitFilters = {
  search: "",
  sort: "visit-time",
  direction: "desc",
  transition: "",
  from: "",
  to: "",
  profiles: [],
};

/**
 * What an empty filtered list says: the days when the range is the only
 * filter ("No saved visits on 12 Mar 2024."), else the days and "these
 * filters" - so an empty day reads as that day, not as a broken filter.
 */
export function filteredEmptyMessage(
  filters: VisitFilters,
  noun: string,
): string {
  const days =
    filters.from !== "" && filters.to !== ""
      ? filters.from === filters.to
        ? `on ${formatDay(filters.from)}`
        : `in ${formatDaySpan(filters.from, filters.to)}`
      : null;
  const others =
    filters.search !== "" ||
    filters.transition !== "" ||
    filters.profiles.length > 0;
  if (days === null) {
    return `No ${noun} match these filters.`;
  }
  return others
    ? `No ${noun} ${days} match these filters.`
    : `No ${noun} ${days}.`;
}

export function visitsAreFiltered(filters: VisitFilters): boolean {
  return (
    filters.search !== "" ||
    filters.transition !== "" ||
    filters.from !== "" ||
    filters.to !== "" ||
    filters.profiles.length > 0
  );
}

/** Where a URL-named visit is looked up (`useRowSelection`). */
export const VISIT_LOOKUP: RowLookupSource = {
  route: "history",
  parameters: [["view", "visits"]],
};

/** The `history` `view=visits` query for the filters (Commit State is added
 *  per list by `useCommitStateLists`). The date range is in Case days (the
 *  chart's days), so its bounds are that day's instants in the declared
 *  timezone (`dayRangeParameters`; UTC days without one). */
export function visitParameters(
  filters: VisitFilters,
  timeZone: string | null,
): QueryParameters {
  const parameters: (readonly [string, string])[] = [
    ["view", "visits"],
    ["sort", filters.sort],
    ["direction", filters.direction],
    ["limit", String(VISITS_PAGE_LIMIT)],
  ];
  if (filters.search !== "") {
    parameters.push(["search", filters.search]);
  }
  if (filters.transition !== "") {
    parameters.push(["transition", filters.transition]);
  }
  parameters.push(
    ...dayRangeParameters({ from: filters.from, to: filters.to }, timeZone),
  );
  for (const profile of filters.profiles) {
    parameters.push(["profile", profile]);
  }
  return parameters;
}

/**
 * The recorded Chrome core transition, as a plain-language label. An unknown
 * value passes through verbatim; a missing one keeps its own state word.
 */
export const TRANSITION_LABELS: Readonly<Record<string, string>> = {
  link: "Followed a link",
  typed: "Typed the address",
  auto_bookmark: "Opened a bookmark",
  auto_subframe: "Subframe (auto)",
  manual_subframe: "Subframe (manual)",
  generated: "Address-bar suggestion",
  auto_toplevel: "Auto top-level",
  form_submit: "Submitted a form",
  reload: "Reloaded the page",
  keyword: "Keyword search",
  keyword_generated: "Keyword-generated",
};

/** Sort fields the `visits` view accepts, matching `VIEW_SORTS.visits` in
 *  `core/src/history-query.ts` exactly — a value outside this list is a
 *  request the server would reject. */
const VISIT_SORTS = ["visit-time", "url", "duration", "profile"] as const;

const SORT_LABELS: Readonly<Record<string, string>> = {
  "visit-time": "Time",
  url: "URL",
  duration: "Dwell",
  profile: "Profile",
};

/** Select can't hold an empty value; this stands for "any transition". */
const ANY_TRANSITION = "\u0000any";

/** What the direction toggle says, per sort field, so the tooltip reads as
 *  what the order is ("newest first"), not as an abstract "descending". */
const DIRECTION_WORDS: Readonly<
  Record<string, { readonly desc: string; readonly asc: string }>
> = {
  "visit-time": { desc: "newest first", asc: "oldest first" },
  url: { desc: "Z to A", asc: "A to Z" },
  duration: { desc: "longest first", asc: "shortest first" },
  profile: { desc: "Z to A", asc: "A to Z" },
};

/**
 * The visit filters, laid out by the list's `Toolbar` (right of the
 * Saved / Recovered switch): Sort, Arrived via, Profiles, then the search
 * field last. Every control maps to a real server-side parameter
 * `queryHistory` accepts, so the search commits on Enter/blur.
 */
export function VisitFilterControls({
  filters,
  setFilters,
  profiles,
}: {
  readonly filters: VisitFilters;
  readonly setFilters: (filters: VisitFilters) => void;
  readonly profiles: readonly string[];
}) {
  const descending = filters.direction === "desc";
  const words = DIRECTION_WORDS[filters.sort] ?? {
    desc: "descending",
    asc: "ascending",
  };
  const DirectionIcon = descending ? SortNewestIcon : SortOldestIcon;
  const flip = `Sorted ${descending ? words.desc : words.asc}. Switch to ${
    descending ? words.asc : words.desc
  }`;

  // The transition and the profile pick narrow the list; the sort orders.
  const active =
    (filters.transition === "" ? 0 : 1) + (filters.profiles.length > 0 ? 1 : 0);

  return (
    <>
      <CompactFilters active={active}>
        <FilterField label="Sort" htmlFor="history-visits-sort">
          <Select
            value={filters.sort}
            onValueChange={(sort) => {
              setFilters({ ...filters, sort });
            }}
          >
            <SelectTrigger id="history-visits-sort" className="min-w-[120px]" />
            <SelectContent>
              {VISIT_SORTS.map((sort, index) => (
                <SelectItem key={sort} index={index} value={sort}>
                  {SORT_LABELS[sort] ?? sort}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Tooltip content={flip}>
            <Button
              variant="ghost"
              size="icon-compact"
              aria-label={flip}
              onClick={() => {
                setFilters({
                  ...filters,
                  direction: descending ? "asc" : "desc",
                });
              }}
            >
              <DirectionIcon />
            </Button>
          </Tooltip>
        </FilterField>

        <FilterField label="Arrived via" htmlFor="history-visits-transition">
          <Select
            value={
              filters.transition === "" ? ANY_TRANSITION : filters.transition
            }
            onValueChange={(value) => {
              setFilters({
                ...filters,
                transition: value === ANY_TRANSITION ? "" : value,
              });
            }}
          >
            <SelectTrigger
              id="history-visits-transition"
              className="min-w-[168px]"
            />
            <SelectContent>
              <SelectItem index={0} value={ANY_TRANSITION}>
                Any transition
              </SelectItem>
              {Object.entries(TRANSITION_LABELS).map(
                ([value, label], index) => (
                  <SelectItem key={value} index={index + 1} value={value}>
                    {label}
                  </SelectItem>
                ),
              )}
            </SelectContent>
          </Select>
        </FilterField>

        {profiles.length === 0 ? null : (
          <FilterField label="Profiles" htmlFor="history-visits-profiles">
            <ProfilePicker
              id="history-visits-profiles"
              profiles={profiles}
              selected={filters.profiles}
              onChange={(selected) => {
                setFilters({ ...filters, profiles: selected });
              }}
            />
          </FilterField>
        )}
      </CompactFilters>

      <FilterTextField
        id="history-visits-search"
        label="Search recorded visits"
        icon={SearchIcon}
        value={filters.search}
        placeholder="Search page or URL…"
        onCommit={(search) => {
          setFilters({ ...filters, search });
        }}
      />
    </>
  );
}

/** The Saved / Recovered switch, the date range, the profile pick and the
 *  search live in the URL (view-state.tsx): Back, a refresh and a link
 *  restore them, and the range and profiles are the Case-wide lens. Sort,
 *  direction and "Arrived via" stay this page's own. */
export function useVisitFilters(): readonly [
  VisitFilters,
  (next: VisitFilters | ((current: VisitFilters) => VisitFilters)) => void,
] {
  const [range] = useViewRange();
  const [profiles] = useViewProfiles();
  const [search] = useViewSearch();
  const [own, setOwn] = useState<VisitFilters>(DEFAULT_VISIT_FILTERS);
  const filters = useMemo<VisitFilters>(
    () => ({ ...own, from: range.from, to: range.to, profiles, search }),
    [own, range, profiles, search],
  );
  const setFilters = useCallback(
    (next: VisitFilters | ((current: VisitFilters) => VisitFilters)) => {
      const value = typeof next === "function" ? next(filters) : next;
      setOwn(value);
      const lensChanged =
        value.from !== filters.from ||
        value.to !== filters.to ||
        value.profiles.join("\u0000") !== filters.profiles.join("\u0000");
      if (lensChanged || value.search !== filters.search) {
        updateView(
          {
            from: value.from,
            to: value.to,
            profiles: value.profiles,
            q: value.search === "" ? null : value.search,
          },
          // A search alone replaces the entry; a range or profile is a step.
          { replace: !lensChanged },
        );
      }
    },
    [filters],
  );
  return [filters, setFilters] as const;
}
