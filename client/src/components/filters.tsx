/** The filter toolbar: search, sort, direction, extras, profiles, limit. */
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Search } from "lucide-react";
import { useState } from "react";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig } from "../types.js";
import { Chip, Input, Labeled, SelectNative } from "./ui/misc.js";

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

export function FilterBar({
  config,
  profiles,
  filters,
  onChange,
}: {
  readonly config: ArtifactConfig;
  readonly profiles: readonly string[];
  readonly filters: FilterState;
  readonly onChange: (filters: FilterState) => void;
}) {
  const [draftSearch, setDraftSearch] = useState(filters.search);
  const directions = config.directions ?? ["desc", "asc"];
  const descending = filters.direction === "desc";

  return (
    <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
      <Labeled label="Search" htmlFor={`${config.key}-search`}>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground/70"
          />
          <Input
            id={`${config.key}-search`}
            type="search"
            value={draftSearch}
            placeholder={`Search ${config.label.toLowerCase()}…`}
            onChange={(event) => {
              setDraftSearch(event.target.value);
            }}
            onBlur={() => {
              if (draftSearch !== filters.search) {
                onChange({ ...filters, search: draftSearch });
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && draftSearch !== filters.search) {
                onChange({ ...filters, search: draftSearch });
              }
            }}
            className="w-56 pl-8"
          />
        </div>
      </Labeled>

      <Labeled label="Sort" htmlFor={`${config.key}-sort`}>
        <div className="flex items-center gap-1">
          <SelectNative
            id={`${config.key}-sort`}
            value={filters.sort}
            onChange={(event) => {
              onChange({ ...filters, sort: event.target.value });
            }}
          >
            {config.sorts.map((sort) => (
              <option key={sort} value={sort}>
                {sort}
              </option>
            ))}
          </SelectNative>
          {directions.length > 1 ? (
            <button
              type="button"
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
              className="inline-flex size-8 cursor-pointer items-center justify-center rounded-md border border-border bg-card text-muted-foreground transition-colors duration-150 hover:border-muted-foreground/40 hover:text-foreground"
            >
              {descending ? (
                <ArrowDownWideNarrow aria-hidden="true" className="size-4" />
              ) : (
                <ArrowUpNarrowWide aria-hidden="true" className="size-4" />
              )}
            </button>
          ) : null}
        </div>
      </Labeled>

      {config.extras.map((extra) => (
        <Labeled
          key={extra.parameter}
          label={extra.label}
          htmlFor={`${config.key}-${extra.parameter}`}
        >
          {extra.options === undefined ? (
            <ExtraText
              id={`${config.key}-${extra.parameter}`}
              value={filters.extras[extra.parameter] ?? ""}
              placeholder={extra.placeholder}
              onCommit={(value) => {
                onChange({
                  ...filters,
                  extras: { ...filters.extras, [extra.parameter]: value },
                });
              }}
            />
          ) : (
            <SelectNative
              id={`${config.key}-${extra.parameter}`}
              value={filters.extras[extra.parameter] ?? ""}
              onChange={(event) => {
                onChange({
                  ...filters,
                  extras: {
                    ...filters.extras,
                    [extra.parameter]: event.target.value,
                  },
                });
              }}
            >
              {extra.options.map((option) => (
                <option key={option} value={option}>
                  {option === "" ? "all" : option}
                </option>
              ))}
            </SelectNative>
          )}
        </Labeled>
      ))}

      <Labeled label="Limit" htmlFor={`${config.key}-limit`}>
        <SelectNative
          id={`${config.key}-limit`}
          value={filters.limit}
          onChange={(event) => {
            onChange({ ...filters, limit: event.target.value });
          }}
        >
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
        </SelectNative>
      </Labeled>

      <Labeled label="Profiles">
        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
          {profiles.length === 0 ? (
            <span className="text-[13px] text-muted-foreground italic">
              No Profiles.
            </span>
          ) : (
            profiles.map((profile) => {
              const active = filters.profiles.includes(profile);
              return (
                <Chip
                  key={profile}
                  active={active}
                  onClick={() => {
                    onChange({
                      ...filters,
                      profiles: active
                        ? filters.profiles.filter((entry) => entry !== profile)
                        : [...filters.profiles, profile],
                    });
                  }}
                >
                  {profile}
                </Chip>
              );
            })
          )}
        </div>
      </Labeled>
    </div>
  );
}

function ExtraText({
  id,
  value,
  placeholder,
  onCommit,
}: {
  readonly id: string;
  readonly value: string;
  readonly placeholder?: string;
  readonly onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <Input
      id={id}
      type="text"
      value={draft}
      placeholder={placeholder}
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={() => {
        if (draft !== value) {
          onCommit(draft);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && draft !== value) {
          onCommit(draft);
        }
      }}
      className="w-36"
    />
  );
}
