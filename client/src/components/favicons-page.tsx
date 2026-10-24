/**
 * The Favicons page.
 *
 * Chrome stores one bitmap per site icon it has seen, keyed by an icon URL
 * and carrying the pages that reference it — the browser's own visual index
 * of the hosts it rendered. One figure strip (saved icons, unique bitmaps,
 * stored size — plain counts of the loaded saved rows) sits above the
 * "Cached icons" panel, whose Saved / Recovered switch (CommitStateSplit)
 * shows one `ResponsiveRows` list at a time (a table from `sm` up, stacked
 * rows below), with the profile picker and a live search on its toolbar.
 *
 * Presentation rules kept: a cell without its own recorded value reads as
 * the word "(empty)", "absent" or "unavailable", never colour alone; saved
 * rows and rows recovered from the WAL / rollback journal are separate
 * server reads (`useCommitStateLists`) and separate lists, never sorted
 * together; the figures count saved rows only; nothing is inferred.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

import { Panel } from "@/components/panel";
import { Skeleton } from "@/components/ui/misc";
import { MissingImageIcon, SearchIcon } from "@/lib/app-icons";

import type { QueryParameters } from "../api.js";
import type { ArtifactConfig, Finding } from "../types.js";
import {
  type PaginatedList,
  type RecoveredList,
  useCommitStateLists,
} from "../use-commit-state-lists.js";
import { EmptyRows } from "./data-table.js";
import {
  FieldCell,
  fieldInteger,
  fieldText,
  hostOf,
  StateWord,
  TwoLineCell,
  profileLabel,
} from "./finding-fields.js";
import { FilterField, FilterTextField, ProfilePicker } from "./filters.js";
import { ListBlock, RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import {
  CommitStateSplit,
  type CommitView,
  formatBytes,
  ResponsiveRows,
  type RowColumn,
  SectionPanel,
  TimeCell,
} from "./page-kit.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { useOwnBitmaps } from "./site-favicons.js";

/** Newest refresh first; each Commit State is its own read. */
const FAVICON_PARAMETERS: QueryParameters = [
  ["sort", "last-updated"],
  ["direction", "desc"],
];

/* ------------------------------- field reads ------------------------------- */

/** The host a favicon belongs to: its icon URL host, then its first page URL. */
function faviconHost(row: Finding): string | null {
  const fromIcon = hostOf(fieldText(row.fields.iconUrl));
  if (fromIcon !== null) {
    return fromIcon.replace(/^www\./, "");
  }
  const pages = row.fields.pageUrls;
  if (pages !== undefined && pages.state === "value") {
    const list = pages.value;
    if (Array.isArray(list)) {
      const first = list.find(
        (entry): entry is string => typeof entry === "string",
      );
      const host = hostOf(first ?? null);
      if (host !== null) {
        return host.replace(/^www\./, "");
      }
    }
  }
  return null;
}

/** A favicon's stored resolution as a `"32×32"` label, or null when absent. */
function resolutionLabel(row: Finding): string | null {
  const width = fieldInteger(row.fields.width);
  const height = fieldInteger(row.fields.height);
  if (width === null || height === null) {
    return null;
  }
  return `${String(width)}×${String(height)}`;
}

function faviconBytes(row: Finding): number | null {
  return fieldInteger(row.fields.payloadBytes);
}

/* --------------------------------- widgets --------------------------------- */

/**
 * The figure strip: how many saved icons, how many distinct stored bitmaps
 * (identical hashes are the browser reusing one image), and their on-disk
 * size. Plain counts of the loaded saved rows; recovered rows are never
 * added in.
 */
function SummaryBand({
  rows,
  more,
}: {
  readonly rows: readonly Finding[];
  /** More saved rows stand on the server. */
  readonly more: boolean;
}) {
  const stats = useMemo(() => {
    const hashes = new Set<string>();
    let totalBytes = 0;
    let sizedRows = 0;
    for (const row of rows) {
      const hash = fieldText(row.fields.payloadSha256);
      if (hash !== null) {
        hashes.add(hash);
      }
      const bytes = faviconBytes(row);
      if (bytes !== null) {
        totalBytes += bytes;
        sizedRows += 1;
      }
    }
    return { distinctBitmaps: hashes.size, totalBytes, sizedRows };
  }, [rows]);

  return (
    <MetricBand className="grid-cols-2 lg:grid-cols-3">
      <MetricBandItem
        label="Saved icons"
        value={`${rows.length.toLocaleString("en-US")}${more ? "+" : ""}`}
      />
      <MetricBandItem
        label="Unique bitmaps"
        value={stats.distinctBitmaps.toLocaleString("en-US")}
      />
      <MetricBandItem
        label="Stored size"
        value={
          stats.sizedRows === 0 ? "not recorded" : formatBytes(stats.totalBytes)
        }
      />
    </MetricBand>
  );
}

/* ---------------------------------- table ---------------------------------- */

/** The recovered bitmaps on show, by SHA-256 (`useOwnBitmaps`). */
const BitmapsContext = createContext<ReadonlyMap<string, string>>(new Map());

/**
 * The site: the icon itself in the avatar tile, then the icon's host over
 * its icon URL (mono, muted, a step smaller). The tile holds the row's own
 * stored bitmap only - one whose bytes hash to this row's `payloadSha256` -
 * and otherwise the host's letter, never another bitmap of the same host.
 * The URL line keeps its own state word, so an unavailable icon URL still
 * reads "unavailable" under the host its page URL names; with no host at
 * all, the icon URL (or its word) stands alone.
 */
function SiteCell({
  row,
  avatar = true,
}: {
  readonly row: Finding;
  readonly avatar?: boolean;
}) {
  const bitmaps = useContext(BitmapsContext);
  const host = faviconHost(row);
  const sha = fieldText(row.fields.payloadSha256);
  return (
    <TwoLineCell
      primary={host ?? row.fields.iconUrl}
      secondary={host === null ? null : row.fields.iconUrl}
      mono={host === null}
      avatar={avatar ? host : undefined}
      avatarSrc={sha === null ? null : (bitmaps.get(sha) ?? null)}
    />
  );
}

/** "32×32", else the word of whichever edge was not recorded as a number. */
function ResolutionCell({ row }: { readonly row: Finding }) {
  const label = resolutionLabel(row);
  if (label !== null) {
    return label;
  }
  const missing =
    fieldInteger(row.fields.width) === null
      ? row.fields.width
      : row.fields.height;
  return <FieldCell field={missing} />;
}

const SITE_COLUMN: RowColumn<Finding> = {
  key: "site",
  header: "Site",
  className: "max-w-[420px] min-w-[240px]",
  stack: "title",
  // The icon is this page's evidence, so the phone card keeps it too.
  cell: (row) => <SiteCell row={row} />,
};

const RESOLUTION_COLUMN: RowColumn<Finding> = {
  key: "resolution",
  header: "Resolution",
  className: "whitespace-nowrap",
  cell: (row) => <ResolutionCell row={row} />,
};

const SIZE_COLUMN: RowColumn<Finding> = {
  key: "size",
  header: "Size",
  className: "text-right whitespace-nowrap tabular-nums",
  cell: (row) => {
    const bytes = faviconBytes(row);
    return bytes === null ? (
      <FieldCell field={row.fields.payloadBytes} />
    ) : (
      <span title={`${bytes.toLocaleString("en-US")} bytes`}>
        {formatBytes(bytes)}
      </span>
    );
  },
};

const UPDATED_COLUMN: RowColumn<Finding> = {
  key: "updated",
  header: "Last updated",
  className: "whitespace-nowrap",
  stack: "lead",
  cell: (row) => <TimeCell field={row.fields.lastUpdated} />,
};

const PROFILE_COLUMN: RowColumn<Finding> = {
  key: "profile",
  header: "Profile",
  className: "whitespace-nowrap",
  cell: (row) => profileLabel(row.profile),
};

/** Saved icons carry no State column (every row is saved). */
const SAVED_COLUMNS: readonly RowColumn<Finding>[] = [
  SITE_COLUMN,
  RESOLUTION_COLUMN,
  SIZE_COLUMN,
  UPDATED_COLUMN,
  PROFILE_COLUMN,
];

/** Recovered icons add the State word: which sidecar, and whether the row
 *  was unsaved or overwritten. */
const RECOVERED_COLUMNS: readonly RowColumn<Finding>[] = [
  ...SAVED_COLUMNS,
  {
    key: "state",
    header: "State",
    stack: "aside",
    cell: (row) => <StateWord state={row.commitState} />,
  },
];

function IconsTable({
  rows,
  recovered,
  onSelect,
}: {
  readonly rows: readonly Finding[];
  readonly recovered: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  return (
    <ResponsiveRows
      rows={rows}
      columns={recovered ? RECOVERED_COLUMNS : SAVED_COLUMNS}
      // A WAL and a journal copy of one bitmap share its id, so the Commit
      // State (and the position) keep the key unique.
      rowKey={(row, index) =>
        `${row.commitState}:${row.profile}:${fieldText(row.fields.bitmapId) ?? ""}:${String(index)}`
      }
      rowLabel={(row) =>
        `Open favicon row detail for ${faviconHost(row) ?? "a host not recorded"}`
      }
      onSelect={onSelect}
      tableClassName="tabular-nums"
    />
  );
}

/**
 * One list (saved or recovered): its loading rows, its read error, its empty
 * state, the table, a load-more failure (Retry asks for that page again and
 * keeps the loaded rows), and the "N shown / Load more" footer.
 */
function IconList({
  list,
  visible,
  noun,
  onSelect,
  onClearFilters,
}: {
  readonly list: PaginatedList<Finding> | RecoveredList<Finding>;
  readonly visible: readonly Finding[];
  readonly noun: "saved" | "recovered";
  readonly onSelect: (row: Finding) => void;
  readonly onClearFilters: () => void;
}) {
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} icon`, many: `${noun} icons` }}
      shown={visible.length}
      onClearFilters={onClearFilters}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved Favicons rows in this Case."
              : "No icons were recovered from Chrome's temporary database files."
          }
        />
      }
    >
      <IconsTable
        rows={visible}
        recovered={noun === "recovered"}
        onSelect={onSelect}
      />
    </ListBlock>
  );
}

/* --------------------------------- loading --------------------------------- */

/** Stands in for the figure strip while the first saved page loads, at its
 *  size. */
function FiguresSkeleton() {
  return (
    <div role="status" aria-label="Loading favicon figures">
      <Skeleton className="h-[74px] w-full rounded-xl" />
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function FaviconsPage({ config }: { readonly config: ArtifactConfig }) {
  const lists = useCommitStateLists<Finding>(config.route, FAVICON_PARAMETERS);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const [view, setView] = useState<CommitView>("saved");
  const [search, setSearch] = useState("");
  const [profileFilter, setProfileFilter] = useState<readonly string[]>([]);

  const savedRows = lists.saved.rows;
  const recoveredRows = lists.recovered.rows;

  const profiles = useMemo(
    () =>
      [
        ...new Set([...savedRows, ...recoveredRows].map((row) => row.profile)),
      ].sort(),
    [savedRows, recoveredRows],
  );

  const hosts = useMemo(
    () =>
      [...savedRows, ...recoveredRows].flatMap((row) => {
        const host = faviconHost(row);
        return host === null ? [] : [host];
      }),
    [savedRows, recoveredRows],
  );
  const bitmaps = useOwnBitmaps(hosts);

  const narrow = useCallback(
    (rows: readonly Finding[]) => {
      const query = search.trim().toLocaleLowerCase("en-US");
      return rows.filter((row) => {
        if (profileFilter.length > 0 && !profileFilter.includes(row.profile)) {
          return false;
        }
        if (query === "") {
          return true;
        }
        const haystack = [
          faviconHost(row) ?? "",
          fieldText(row.fields.iconUrl) ?? "",
        ]
          .join("\n")
          .toLocaleLowerCase("en-US");
        return haystack.includes(query);
      });
    },
    [search, profileFilter],
  );
  const savedVisible = useMemo(() => narrow(savedRows), [narrow, savedRows]);
  const recoveredVisible = useMemo(
    () => narrow(recoveredRows),
    [narrow, recoveredRows],
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setProfileFilter([]);
  }, []);

  const savedFirst = lists.saved.loading && savedRows.length === 0;
  const recoveredFirst = lists.recovered.loading && recoveredRows.length === 0;
  const pageEmpty =
    !savedFirst &&
    !recoveredFirst &&
    lists.saved.error === null &&
    lists.recovered.error === null &&
    savedRows.length === 0 &&
    recoveredRows.length === 0;
  // The figures read the saved rows only; with none (or a failed read) they
  // step aside and the Saved tab carries the reason.
  const showFigures =
    savedFirst || (lists.saved.error === null && savedRows.length > 0);

  return (
    <div className="flex flex-col gap-5">
      {pageEmpty ? (
        <Panel>
          <EmptyRows
            icon={MissingImageIcon}
            title="No cached icons"
            message="No Favicons rows in this Case, saved or recovered."
          />
        </Panel>
      ) : (
        <>
          {showFigures ? (
            <RevealSwap loading={savedFirst} skeleton={<FiguresSkeleton />}>
              <SummaryBand
                rows={savedRows}
                more={lists.saved.cursor !== null}
              />
            </RevealSwap>
          ) : null}

          <BitmapsContext.Provider value={bitmaps}>
            <SectionPanel id="favicons-list" title="Cached icons">
              <CommitStateSplit
                value={view}
                onValueChange={setView}
                label="Saved or recovered icons"
                savedCount={
                  savedFirst ||
                  (lists.saved.error !== null && savedRows.length === 0)
                    ? null
                    : savedRows.length
                }
                recoveredCount={
                  recoveredFirst ||
                  (lists.recovered.error !== null && recoveredRows.length === 0)
                    ? null
                    : recoveredRows.length
                }
                savedMore={lists.saved.cursor !== null}
                recoveredMore={lists.recovered.cursor !== null}
                toolbar={
                  <>
                    {profiles.length > 1 ? (
                      <FilterField label="Profiles" htmlFor="favicons-profiles">
                        <ProfilePicker
                          id="favicons-profiles"
                          profiles={profiles}
                          selected={profileFilter}
                          onChange={setProfileFilter}
                        />
                      </FilterField>
                    ) : null}
                    <FilterTextField
                      commit="change"
                      label="Search loaded favicons"
                      icon={SearchIcon}
                      placeholder="Search host or icon URL"
                      value={search}
                      onCommit={setSearch}
                    />
                  </>
                }
                saved={
                  <IconList
                    list={lists.saved}
                    visible={savedVisible}
                    noun="saved"
                    onSelect={select}
                    onClearFilters={clearFilters}
                  />
                }
                recovered={
                  <IconList
                    list={lists.recovered}
                    visible={recoveredVisible}
                    noun="recovered"
                    onSelect={select}
                    onClearFilters={clearFilters}
                  />
                }
              />
            </SectionPanel>
          </BitmapsContext.Provider>
        </>
      )}

      {selected !== null ? (
        <RowSheet
          selected={selected}
          title="Favicon"
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
