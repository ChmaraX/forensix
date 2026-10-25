/**
 * The Top sites page.
 *
 * Chrome's own most-visited ranking: one ordered list per Browser Profile
 * (`urlRank` 1..N, its own placement — nothing this page re-ranks). The list
 * is ten-odd rows, so the page is the list alone: one table section, read as
 * two server reads kept apart (forensic rule 4) — Saved (committed) and
 * Recovered (WAL then journal), switched with `CommitStateSplit` — with
 * Profiles (`ProfilePicker`, when the Case has more than one Profile; a
 * server filter, so the lists hold the picked profiles' rows only) and a
 * live search narrowing the loaded rows of either list.
 *
 * Columns: Rank (Chrome's recorded `urlRank`), Site (title over URL, the
 * URL's host linked to Sites when Sites lists that exact host), Profile
 * (only while more than one profile can be listed), and — in the Recovered
 * list only — the Commit State word (every saved row would say "saved").
 * `ResponsiveRows` stacks each row into a card below `sm`.
 *
 * The profile pick is the Case-wide lens (`useProfileLens`); the search,
 * the Saved / Recovered tab and the open row live in the URL, so Back and
 * a refresh restore the view.
 *
 * Presentation rules kept: the shell's coverage indicator sits by the title,
 * before any row; states are worded, never colour alone; ranks are Chrome's
 * recorded values — never scores or bars the evidence does not contain.
 */
import { useCallback, useMemo } from "react";

import {
  updateView,
  useRowSelection,
  useViewSearch,
  useViewTab,
} from "../view-state.js";

import { SearchIcon } from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import { rowRefOf } from "../router.js";

import type { Finding } from "../types.js";
import { ARTIFACTS } from "../artifacts.js";
import type { RowLookupSource } from "../row-lookup.js";
import {
  commitStateStatus,
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
  TwoLineCell,
} from "./finding-fields.js";
import { FilterTextField, matchesSearch, ProfilePicker } from "./filters.js";
import { useProfileLens } from "./identity-kit.js";
import { ListBlock } from "./list-states.js";
import {
  CommitStateSplit,
  ResponsiveRows,
  SectionPanel,
  type RowColumn,
} from "./page-kit.js";
import { RowSheet } from "./row-sheet.js";
import { Term } from "./term.js";
import { UrlWithSiteLink } from "./host-link.js";

/** Chrome's own order: rank ascending (Commit State is added per list). */
const RANK_ORDER: readonly (readonly [string, string])[] = [
  ["sort", "rank"],
  ["direction", "asc"],
];

/** A ranked site: its title over its URL. */
function SitePage({ row }: { readonly row: Finding }) {
  return (
    <TwoLineCell
      primary={row.fields.title}
      secondary={row.fields.url}
      mono={false}
    />
  );
}

/** The table's site cell: the site tile, the title over the URL, and the
 *  URL's host linked to Sites when Sites lists that exact host. */
function SitePageLinked({ row }: { readonly row: Finding }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar host={hostOf(fieldText(row.fields.url))} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="block min-w-0 text-foreground">
          <FieldCell field={row.fields.title} mono={false} />
        </span>
        <SizeProvider size="compact">
          <span className="block min-w-0 text-muted-foreground">
            <UrlWithSiteLink field={row.fields.url} />
          </span>
        </SizeProvider>
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

/** "1", "1 and 7", "1, 4 and 7". */
function rankList(ranks: readonly number[]): string {
  const words = ranks.map(String);
  return words.length <= 1
    ? (words[0] ?? "")
    : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1] ?? ""}`;
}

/**
 * The ranks the saved list skips (no saved row of any loaded profile holds
 * them, up to the highest loaded rank), said once above the saved list and in the Rank header's note -
 * "Saved ranks skip 1 and 7: rank 1 is a recovered row (Recovered tab);
 * rank 7 is in neither list." - so a saved list starting at 2 reads as the
 * evidence, not a bug. Null when the saved ranks have no gap.
 */
function rankGapNote(
  saved: readonly Finding[],
  recovered: readonly Finding[],
): string | null {
  // Over every loaded profile at once: a rank is skipped when no saved row
  // of any profile holds it (each profile ranks from 1, so a multi-profile
  // Case does not read every other profile's ranks as gaps).
  const ranksOf = (rows: readonly Finding[]) =>
    new Set(
      rows.flatMap((row) => {
        const rank = fieldInteger(row.fields.urlRank);
        return rank === null || rank < 1 ? [] : [rank];
      }),
    );
  const savedRanks = ranksOf(saved);
  const recoveredRanks = ranksOf(recovered);
  if (savedRanks.size === 0) {
    return null;
  }
  const highest = Math.max(...savedRanks, ...recoveredRanks);
  const inRecovered: number[] = [];
  const inNeither: number[] = [];
  for (let rank = 1; rank <= highest; rank += 1) {
    if (!savedRanks.has(rank)) {
      (recoveredRanks.has(rank) ? inRecovered : inNeither).push(rank);
    }
  }
  const skipped = [...inRecovered, ...inNeither].sort(
    (left, right) => left - right,
  );
  if (skipped.length === 0) {
    return null;
  }
  const parts = [
    inRecovered.length === 0
      ? null
      : inRecovered.length === 1
        ? `rank ${rankList(inRecovered)} is a recovered row (Recovered tab)`
        : `ranks ${rankList(inRecovered)} are recovered rows (Recovered tab)`,
    inNeither.length === 0
      ? null
      : inNeither.length === 1
        ? `rank ${rankList(inNeither)} is in neither list`
        : `ranks ${rankList(inNeither)} are in neither list`,
  ].filter((part): part is string => part !== null);
  return `Saved ranks skip ${rankList(skipped)}: ${parts.join("; ")}.`;
}

/** The ranked table's columns. On a phone the card reads the rank (and, in
 *  the Recovered list, the State word) on its first line, the site as its
 *  title, and the Profile under it. `note` explains a gap in the ranks
 *  (the Rank header's tooltip); the table links each URL's host to
 *  Sites (not a phone card); `withProfile` adds the Profile column, left out when every
 *  loaded row names the same profile (it would read the same on every
 *  row - the row sheet keeps it). */
function rankColumns({
  note,
  withProfile,
  recovered,
}: {
  readonly note: string | null;
  readonly withProfile: boolean;
  readonly recovered: boolean;
}): readonly RowColumn<Finding>[] {
  const columns: RowColumn<Finding>[] = [
    {
      key: "rank",
      header:
        note === null ? (
          "Rank"
        ) : (
          <Term label="Rank">{`Chrome's own rank. ${note}`}</Term>
        ),
      label: "Rank",
      className: "w-16 text-right tabular-nums",
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
      cell: (row) => <SitePageLinked row={row} />,
      stackedCell: (row) => <SitePage row={row} />,
    },
  ];
  if (withProfile) {
    columns.push({
      key: "profile",
      header: "Profile",
      className: "w-[160px] whitespace-nowrap",
      cell: (row) => profileLabel(row.profile),
    });
  }
  if (recovered) {
    columns.push({
      key: "state",
      header: "State",
      className: "w-[184px] whitespace-nowrap",
      stack: "aside",
      cell: (row) => <StateWord state={row.commitState} />,
    });
  }
  return columns;
}

/** A row's stable key: its row reference. */
function topSiteKey(row: Finding, index: number): string {
  return rowRefOf(row) ?? `${row.commitState}-${String(index)}`;
}

function topSiteLabel(row: Finding): string {
  return `Open top site row detail: ${fieldText(row.fields.title) ?? fieldText(row.fields.url) ?? "top site"}`;
}

/** One of the two ranked lists, narrowed by the page's Profiles and search
 *  over its loaded rows. */
function RankedList({
  list,
  recovered,
  rankNote = null,
  matches,
  filtered,
  onClearFilters,
  onSelect,
  withProfile,
}: {
  readonly list: PaginatedList<Finding>;
  readonly recovered: boolean;
  /** Why the saved ranks skip numbers (the Rank header's tooltip). */
  readonly rankNote?: string | null;
  readonly matches: (row: Finding) => boolean;
  readonly filtered: boolean;
  readonly onClearFilters: () => void;
  readonly onSelect: (row: Finding) => void;
  /** The Profile column (when the loaded rows span profiles). */
  readonly withProfile: boolean;
}) {
  const visible = useMemo(
    () => list.rows.filter(matches),
    [list.rows, matches],
  );
  const columns = useMemo(
    () =>
      rankColumns({
        note: recovered ? null : rankNote,
        withProfile,
        recovered,
      }),
    [recovered, rankNote, withProfile],
  );
  const note = recovered || visible.length === 0 ? null : rankNote;
  return (
    <>
      {/* Said once, above the ranks it explains (also the Rank header's
          note). */}
      {note === null ? null : (
        <p
          className={cn(
            typeClass("caption"),
            "px-4 pt-2 text-muted-foreground tabular-nums",
          )}
        >
          {note}
        </p>
      )}
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
          columns={columns}
          rowKey={topSiteKey}
          rowLabel={topSiteLabel}
          onSelect={onSelect}
          tableClassName="min-w-[560px]"
        />
      </ListBlock>
    </>
  );
}

const config = ARTIFACTS["top-sites"];
/** A URL-named row this page has not loaded is read by its reference. */
const ROW_LOOKUP: RowLookupSource = { route: config.route };

export function TopSitesPage() {
  // The profile pick is the Case-wide lens, applied by the server.
  const lens = useProfileLens();
  const parameters = useMemo(
    () => [...RANK_ORDER, ...lens.parameters],
    [lens.parameters],
  );
  const lists = useCommitStateLists<Finding>(config.route, parameters);
  // Saved / Recovered lives in the URL (`tab`): Back and a refresh keep it.
  const [view, setView] = useViewTab();
  // The search lives in the URL.
  const [search, setSearch] = useViewSearch();

  const saved = lists.saved;
  const recovered = lists.recovered;
  const loaded = useMemo(
    () => [...saved.rows, ...recovered.rows],
    [saved.rows, recovered.rows],
  );
  // The open row lives in the URL: Back and a refresh re-open it.
  const sheet = useRowSelection(loaded, ROW_LOOKUP);

  // The Profile column while more than one profile can be listed (one
  // picked profile would read the same on every row).
  const withProfile = lens.options.length > 1 && lens.selected.length !== 1;

  const rankNote = useMemo(
    () => rankGapNote(saved.rows, recovered.rows),
    [saved.rows, recovered.rows],
  );

  const filtered = search.trim() !== "" || lens.selected.length > 0;
  const matches = useCallback(
    (row: Finding) =>
      matchesSearch(search, [
        fieldText(row.fields.url),
        fieldText(row.fields.title),
      ]),
    [search],
  );
  // The tabs count every loaded row of the lens; the search narrows the
  // lists.
  const { split } = commitStateStatus(lists, {
    saved: saved.rows.length,
    recovered: recovered.rows.length,
  });

  const clearFilters = useCallback(() => {
    // The search and the profiles in one history entry.
    updateView({ q: null, profiles: [] });
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <SectionPanel id="top-sites-all-title" title="Ranked sites">
        <CommitStateSplit
          value={view}
          onValueChange={setView}
          label="Saved or recovered top sites"
          {...split}
          toolbar={
            <>
              {lens.showPicker ? (
                <ProfilePicker
                  id="top-sites-profiles"
                  profiles={lens.options}
                  selected={lens.selected}
                  onChange={lens.setSelected}
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
              rankNote={rankNote}
              matches={matches}
              filtered={filtered}
              onClearFilters={clearFilters}
              onSelect={sheet.select}
              withProfile={withProfile}
            />
          }
          recovered={
            <RankedList
              list={recovered}
              recovered
              matches={matches}
              filtered={filtered}
              onClearFilters={clearFilters}
              onSelect={sheet.select}
              withProfile={withProfile}
            />
          }
        />
      </SectionPanel>

      {sheet.selected !== null ? (
        <RowSheet
          selected={sheet.selected}
          title={fieldText(sheet.selected.row.fields.title) ?? "Top site"}
          onClose={sheet.close}
        />
      ) : null}
    </div>
  );
}
