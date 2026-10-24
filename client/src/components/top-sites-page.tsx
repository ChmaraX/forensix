/**
 * The Top sites page.
 *
 * Chrome's own most-visited ranking: one ordered list per Browser Profile
 * (`urlRank` 1..N, its own placement — nothing this page re-ranks). The list
 * is ten-odd rows, so the page is the list alone: one table section, read as
 * two server reads kept apart (forensic rule 4) — Saved (committed) and
 * Recovered (WAL then journal), switched with `CommitStateSplit` — with
 * Profiles (`ProfilePicker`, when more than one Profile ranked) and a live
 * search narrowing the loaded rows of either list.
 *
 * Columns: Rank (Chrome's recorded `urlRank`), Site (title over URL),
 * Profile, and — in the Recovered list only — the Commit State word (every
 * saved row would say "saved"). `ResponsiveRows` stacks each row into a
 * card below `sm`.
 *
 * Presentation rules kept: the shell's coverage indicator sits by the title,
 * before any row; states are worded, never colour alone; ranks are Chrome's
 * recorded values — never scores or bars the evidence does not contain.
 */
import { useCallback, useMemo, useState } from "react";

import { SearchIcon } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { useSize } from "@/lib/size-context";

import type { ArtifactConfig, Finding } from "../types.js";
import {
  useCommitStateLists,
  type PaginatedList,
} from "../use-commit-state-lists.js";
import { EmptyRows } from "./data-table.js";
import {
  FieldCell,
  fieldInteger,
  fieldText,
  hostOf,
  profileLabel,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { FilterTextField, ProfilePicker } from "./filters.js";
import { ListBlock } from "./list-states.js";
import {
  CommitStateSplit,
  ResponsiveRows,
  SectionPanel,
  type CommitView,
  type RowColumn,
} from "./page-kit.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

/** Chrome's own order: rank ascending (Commit State is added per list). */
const RANK_ORDER: readonly (readonly [string, string])[] = [
  ["sort", "rank"],
  ["direction", "asc"],
];

function asText(value: unknown): string {
  return typeof value === "string" ? value : String(value);
}

/** A ranked site: its title over its URL (monospace, caption). */
function SitePage({ row }: { readonly row: Finding }) {
  const size = useSize();
  const url = fieldText(row.fields.url);
  const title = fieldText(row.fields.title);
  return (
    <span className="flex min-w-0 flex-col">
      <span className="min-w-0" title={title ?? undefined}>
        <FieldCell
          field={row.fields.title}
          format={asText}
          className="text-foreground"
        />
      </span>
      <span className="min-w-0" title={url ?? undefined}>
        <FieldCell
          field={row.fields.url}
          format={asText}
          mono
          className={size.type.caption}
        />
      </span>
    </span>
  );
}

/** Chrome's recorded rank, or the rank field's own state word. */
function Rank({ row }: { readonly row: Finding }) {
  const rank = fieldInteger(row.fields.urlRank);
  return rank === null ? (
    <FieldCell field={row.fields.urlRank} />
  ) : (
    <span
      className="text-foreground tabular-nums"
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {rank}
    </span>
  );
}

/** The ranked table's columns. On a phone the card reads the rank (and, in
 *  the Recovered list, the State word) on its first line, the site as its
 *  title, and the Profile under it. */
const RANK_COLUMNS: readonly RowColumn<Finding>[] = [
  {
    key: "rank",
    header: "Rank",
    className: "w-16",
    stack: "lead",
    cell: (row) => <Rank row={row} />,
    stackedCell: (row) => {
      const rank = fieldInteger(row.fields.urlRank);
      return rank === null ? (
        <FieldCell field={row.fields.urlRank} />
      ) : (
        `#${String(rank)}`
      );
    },
  },
  {
    key: "site",
    header: "Site",
    className: "max-w-[520px]",
    stack: "title",
    cell: (row) => (
      <span className="flex items-center gap-2.5">
        <SiteAvatar host={hostOf(fieldText(row.fields.url))} />
        <SitePage row={row} />
      </span>
    ),
    stackedCell: (row) => <SitePage row={row} />,
  },
  {
    key: "profile",
    header: "Profile",
    className: "whitespace-nowrap",
    cell: (row) => row.profile,
    stackedCell: (row) => profileLabel(row.profile),
  },
];

const RECOVERED_RANK_COLUMNS: readonly RowColumn<Finding>[] = [
  ...RANK_COLUMNS,
  {
    key: "state",
    header: "State",
    className: "whitespace-nowrap",
    stack: "aside",
    cell: (row) => <StateWord state={row.commitState} />,
  },
];

/** One of the two ranked lists, narrowed by the page's Profiles and search
 *  over its loaded rows. */
function RankedList({
  list,
  recovered,
  matches,
  filtered,
  onClearFilters,
  onSelect,
}: {
  readonly list: PaginatedList<Finding>;
  readonly recovered: boolean;
  readonly matches: (row: Finding) => boolean;
  readonly filtered: boolean;
  readonly onClearFilters: () => void;
  readonly onSelect: (row: Finding) => void;
}) {
  const visible = useMemo(
    () => list.rows.filter(matches),
    [list.rows, matches],
  );
  return (
    <ListBlock
      list={list}
      noun={
        recovered
          ? { one: "recovered row", many: "recovered rows" }
          : { one: "saved row", many: "saved rows" }
      }
      shown={visible.length}
      filtered={filtered}
      onClearFilters={onClearFilters}
      skeletonRows={recovered ? 3 : 8}
      empty={
        <EmptyRows
          title={recovered ? "No recovered rows" : "No saved rows"}
          message={
            recovered
              ? "Neither the write-ahead log nor the rollback journal holds a Top sites row."
              : "The Top Sites database holds no committed rows."
          }
        />
      }
    >
      <ResponsiveRows
        rows={visible}
        columns={recovered ? RECOVERED_RANK_COLUMNS : RANK_COLUMNS}
        rowKey={(row, index) => `${row.commitState}-${String(index)}`}
        rowLabel={(row) =>
          `Open top site row detail: ${fieldText(row.fields.title) ?? fieldText(row.fields.url) ?? "top site"}`
        }
        onSelect={onSelect}
        tableClassName="min-w-[560px]"
      />
    </ListBlock>
  );
}

function countOf(list: PaginatedList<unknown>): number | null {
  return list.loading && list.rows.length === 0 ? null : list.rows.length;
}

export function TopSitesPage({ config }: { readonly config: ArtifactConfig }) {
  const lists = useCommitStateLists<Finding>(config.route, RANK_ORDER);
  const [view, setView] = useState<CommitView>("saved");
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<readonly string[]>([]);

  const saved = lists.saved;
  const recovered = lists.recovered;

  const profiles = useMemo(
    () =>
      [
        ...new Set(
          [...saved.rows, ...recovered.rows].map((row) => row.profile),
        ),
      ].sort(),
    [saved.rows, recovered.rows],
  );

  const query = search.trim().toLocaleLowerCase("en-US");
  const filtered = query !== "" || profileFilter.length > 0;
  const matches = useCallback(
    (row: Finding) => {
      if (profileFilter.length > 0 && !profileFilter.includes(row.profile)) {
        return false;
      }
      if (query === "") {
        return true;
      }
      return [
        fieldText(row.fields.url) ?? "",
        fieldText(row.fields.title) ?? "",
      ]
        .join("\n")
        .toLocaleLowerCase("en-US")
        .includes(query);
    },
    [profileFilter, query],
  );

  const clearFilters = useCallback(() => {
    setSearch("");
    setProfileFilter([]);
  }, []);

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <SectionPanel id="top-sites-all-title" title="Ranked sites">
        <CommitStateSplit
          value={view}
          onValueChange={setView}
          label="Saved or recovered top sites"
          savedCount={countOf(saved)}
          recoveredCount={countOf(recovered)}
          savedMore={saved.cursor !== null}
          recoveredMore={recovered.cursor !== null}
          toolbar={
            <>
              {profiles.length > 1 ? (
                <ProfilePicker
                  id="top-sites-profiles"
                  profiles={profiles}
                  selected={profileFilter}
                  onChange={setProfileFilter}
                />
              ) : null}
              <FilterTextField
                id="top-sites-search"
                commit="change"
                label="Search loaded top sites"
                icon={SearchIcon}
                value={search}
                placeholder="Search site or title…"
                onCommit={setSearch}
              />
            </>
          }
          saved={
            <RankedList
              list={saved}
              recovered={false}
              matches={matches}
              filtered={filtered}
              onClearFilters={clearFilters}
              onSelect={select}
            />
          }
          recovered={
            <RankedList
              list={recovered}
              recovered
              matches={matches}
              filtered={filtered}
              onClearFilters={clearFilters}
              onSelect={select}
            />
          }
        />
      </SectionPanel>

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={fieldText(selected.row.fields.title) ?? "Top site"}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
