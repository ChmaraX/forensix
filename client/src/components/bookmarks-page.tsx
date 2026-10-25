/**
 * The Bookmarks page.
 *
 * Bookmarks are the one evidence kind the subject *curated* — every row is a
 * page they chose to keep and a folder they chose to file it under. So this
 * page reads them as a collection, not a log: a figure strip (saved
 * bookmarks, folders, distinct sites, rows read from the `.bak` backup copy),
 * then the folder tree they built beside the row lists. Every figure is a
 * plain reading of fields the evidence already carries (`name`, `url`,
 * `dateAdded`, `folderPath`, `sourceFile`).
 *
 * The folder navigator rebuilds the subject's own hierarchy from
 * `folderPath`, with per-branch counts; picking a folder focuses both lists
 * on that folder and everything beneath it.
 *
 * Saved bookmarks and bookmarks recovered from WAL / journal sidecars are
 * separate server reads (`useCommitStateLists`, every page followed so the
 * figures cover the whole set) and separate lists (the Saved / Recovered
 * tabs); every figure counts saved rows only. Columns are curated:
 * Bookmark (name over URL - the URL opens History when History holds a
 * visit to exactly that URL), Folder, Added, Source (live file vs. `.bak`
 * backup), and - in the Recovered tab - the Commit State word; every wire
 * field stays reachable in the row sheet. A single-type list, so no TYPE
 * column. Missing values read as their own state word. This page is
 * read-only.
 */
import { useCallback, useMemo } from "react";

import { siteHostKey } from "../site-host-key.js";
import { rowRefOf } from "../router.js";
import {
  useRowSelection,
  useViewFilter,
  useViewSearch,
  useViewTab,
} from "../view-state.js";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { ARTIFACT_ICONS, FolderIcon, SearchIcon } from "@/lib/app-icons";
import { SizeProvider, useSize } from "@/lib/size-context";
import { cn } from "@/lib/utils";
import type { QueryParameters } from "../api.js";
import type { Finding } from "../types.js";
import { ARTIFACTS } from "../artifacts.js";
import type { RowLookupSource } from "../row-lookup.js";
import {
  commitStateStatus,
  type PaginatedList,
  useCommitStateLists,
} from "../use-commit-state-lists.js";
import { CommitStatePage } from "./commit-state-page.js";
import { EmptyRows } from "./data-table.js";
import { EvidenceDot } from "./evidence.js";
import {
  FieldCell,
  fieldText,
  fieldUtc,
  hostOf,
  SiteAvatar,
  StateWord,
  TwoLineCell,
} from "./finding-fields.js";
import {
  CompactFilters,
  FilterField,
  FilterTextField,
  matchesSearch,
  ProfilePicker,
} from "./filters.js";
import {
  ArtifactEmpty,
  clearSearchAndProfiles,
  emptyCoverageOf,
  EmptyPivot,
  useProfileLens,
} from "./identity-kit.js";
import { VisitedUrlLink } from "./host-link.js";
import { useArtifactCoverage } from "../case-context.js";
import { ListBlock, RevealSwap } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet } from "./row-sheet.js";
import {
  CommitStateSplit,
  ResponsiveRows,
  SectionPanel,
  TimeCell,
  type RowColumn,
} from "./page-kit.js";
import { Term } from "./term.js";
import { FolderNavigator, FolderSelect } from "./bookmarks-folders.js";
import { useMediaQuery } from "./use-media-query.js";

/** Tailwind's `lg`: from here the folder tree stands beside the rows;
 *  below it the folder pick is a Select in the list's toolbar. */
const LG_UP = "(min-width: 64rem)";

/* --------------------------------- reads ---------------------------------- */

const BOOKMARK_PARAMETERS: QueryParameters = [
  ["sort", "date-added"],
  ["direction", "desc"],
  ["limit", "100"],
];

/** Above this many rows per list the read stops; the page then says the
 *  figures are partial. */
const BOOKMARK_ROW_CAP = 15_000;

/* ----------------------------- derived model ------------------------------ */

export interface BookmarkRow {
  readonly finding: Finding;
  readonly name: string | null;
  readonly url: string | null;
  readonly host: string | null;
  readonly folderPath: string | null;
  readonly folderSegments: readonly string[];
  readonly addedUtc: string | null;
  readonly source: string | null;
}

/** Splits a "Bookmarks Bar / Finance" path into trimmed, non-empty segments. */
function segmentsOf(path: string | null): readonly string[] {
  if (path === null) {
    return [];
  }
  return path
    .split("/")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function toRow(finding: Finding): BookmarkRow {
  const url = fieldText(finding.fields.url);
  const folderPath = fieldText(finding.fields.folderPath);
  return {
    finding,
    name: fieldText(finding.fields.name),
    url,
    host: hostOf(url),
    folderPath,
    folderSegments: segmentsOf(folderPath),
    addedUtc: fieldUtc(finding.fields.dateAdded),
    source: fieldText(finding.fields.sourceFile),
  };
}

/**
 * Whether a row came from the backup copy rather than the live bookmarks
 * file. Chrome writes a `Bookmarks.bak` alongside `Bookmarks`; a row read
 * from the `.bak` is evidence the live copy did not carry.
 */
function isBackupSource(source: string | null): boolean {
  return source !== null && source.toLowerCase().includes(".bak");
}

/* --------------------------------- table ---------------------------------- */

/**
 * The source file as a word beside a neutral dot: the live `Bookmarks` file
 * is the quiet default ("Primary"); a row read from the `.bak` copy reads
 * "Backup" in the foreground — a source, not a Commit State, so it never
 * borrows the sidecar hues. A missing source reads its own state word.
 */
function SourceWord({ row }: { readonly row: BookmarkRow }) {
  if (row.source === null) {
    return <FieldCell field={row.finding.fields.sourceFile} />;
  }
  const backup = isBackupSource(row.source);
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 whitespace-nowrap",
        backup && "text-foreground",
      )}
      title={row.source}
    >
      <EvidenceDot state="neutral" />
      {backup ? "Backup" : "Primary"}
    </span>
  );
}

function FolderCell({ row }: { readonly row: BookmarkRow }) {
  const size = useSize();
  if (row.folderPath === null) {
    return <FieldCell field={row.finding.fields.folderPath} />;
  }
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={row.folderPath}>
      <FolderIcon size={size.icon} strokeWidth={1.5} className="shrink-0" />
      <span className="truncate">
        {row.folderSegments[row.folderSegments.length - 1] ?? row.folderPath}
      </span>
    </span>
  );
}

/** The bookmark's name over its URL (the stacked card's title). */
function BookmarkCell({ row }: { readonly row: BookmarkRow }) {
  return (
    <TwoLineCell
      primary={row.finding.fields.name}
      secondary={row.finding.fields.url}
      mono={false}
    />
  );
}

/**
 * The table's bookmark cell: the site's avatar, the name, and under it the
 * URL - which opens History, searched for it, once History is known to
 * hold a visit to exactly that URL (`VisitedUrlLink`). A URL with no such
 * visit stays text: a bookmark is not evidence it was visited.
 */
function LinkedBookmarkCell({ row }: { readonly row: BookmarkRow }) {
  if (row.url === null) {
    return (
      <span className="flex min-w-0 items-center gap-2.5">
        <SiteAvatar host={row.host} />
        <span className="min-w-0 flex-1">
          <BookmarkCell row={row} />
        </span>
      </span>
    );
  }
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar host={row.host} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="block min-w-0 text-foreground">
          <FieldCell field={row.finding.fields.name} mono={false} />
        </span>
        <SizeProvider size="compact">
          <span className="flex min-w-0 text-muted-foreground">
            <VisitedUrlLink url={row.url} className="block truncate font-mono">
              <span title={row.url}>{row.url}</span>
            </VisitedUrlLink>
          </span>
        </SizeProvider>
      </span>
    </span>
  );
}

/**
 * The table's columns: Bookmark (what the person kept leads), Folder,
 * Added, Source, and State in the Recovered tab only. Below `sm` a row
 * stacks: folder and state, the bookmark, then added and source.
 */
function bookmarkColumns(
  recovered: boolean,
): readonly RowColumn<BookmarkRow>[] {
  const columns: RowColumn<BookmarkRow>[] = [
    {
      key: "bookmark",
      header: "Bookmark",
      className: "max-w-[380px]",
      stack: "title",
      cell: (row) => <LinkedBookmarkCell row={row} />,
      stackedCell: (row) => <BookmarkCell row={row} />,
    },
    {
      key: "folder",
      header: "Folder",
      className: "w-[160px] max-w-[160px]",
      stack: "lead",
      cell: (row) => <FolderCell row={row} />,
    },
    {
      key: "added",
      header: "Added (UTC)",
      label: "Added",
      className: "whitespace-nowrap",
      cell: (row) => <TimeCell field={row.finding.fields.dateAdded} />,
    },
    {
      key: "source",
      header: "Source",
      cell: (row) => <SourceWord row={row} />,
    },
  ];
  if (recovered) {
    columns.push({
      key: "state",
      header: "State",
      stack: "aside",
      cell: (row) => <StateWord state={row.finding.commitState} />,
    });
  }
  return columns;
}

const SAVED_COLUMNS = bookmarkColumns(false);
const RECOVERED_COLUMNS = bookmarkColumns(true);

/** A row's key: its reference, so a filter never hands one row's memoised
 *  cells to another. */
function bookmarkKey(row: BookmarkRow, index: number): string {
  return rowRefOf(row.finding) ?? `${row.finding.commitState}-${String(index)}`;
}

function bookmarkLabel(row: BookmarkRow): string {
  return `Open bookmark ${row.name ?? row.url ?? "with no recorded name or URL"}`;
}

/** One list (saved or recovered) with its loading, error, empty and footer. */
function BookmarkList({
  list,
  rows,
  visible,
  noun,
  onSelect,
  onClearFilters,
  filteredMessage,
}: {
  readonly list: PaginatedList<Finding>;
  readonly rows: readonly BookmarkRow[];
  readonly visible: readonly BookmarkRow[];
  readonly noun: "saved" | "recovered";
  readonly onSelect: (finding: Finding) => void;
  readonly onClearFilters: () => void;
  readonly filteredMessage?: string;
}) {
  const select = useCallback(
    (row: BookmarkRow) => {
      onSelect(row.finding);
    },
    [onSelect],
  );
  return (
    <ListBlock
      list={list}
      noun={{ one: `${noun} bookmark`, many: `${noun} bookmarks` }}
      shown={visible.length}
      filtered={visible.length !== rows.length}
      filteredMessage={filteredMessage}
      onClearFilters={onClearFilters}
      skeletonRows={3}
      empty={
        <EmptyRows
          message={
            noun === "saved"
              ? "No saved bookmarks in this Case."
              : // Chrome keeps bookmarks in a JSON file, not a SQLite
                // database: there is no write-ahead log or journal to
                // recover rows from. Rows from the backup copy are saved
                // rows, marked Backup.
                "Chrome keeps bookmarks in a plain file with no temporary database files, so none are recovered. Rows read from its backup copy are under Saved, marked Backup."
          }
        />
      }
    >
      <ResponsiveRows
        rows={visible}
        columns={noun === "saved" ? SAVED_COLUMNS : RECOVERED_COLUMNS}
        rowKey={bookmarkKey}
        rowLabel={bookmarkLabel}
        onSelect={select}
        tableClassName={noun === "saved" ? "min-w-[660px]" : "min-w-[760px]"}
      />
    </ListBlock>
  );
}

/** Placeholder at the size of the figure strip. */
function BookmarksSkeleton() {
  return (
    <div role="status">
      <span className="sr-only">Loading bookmark figures</span>
      <Skeleton className="h-[150px] w-full rounded-xl lg:h-[76px]" />
    </div>
  );
}

/** Focusing a folder keeps the folder and everything nested beneath it. */
function inFolder(row: BookmarkRow, folder: string): boolean {
  const path = row.folderPath;
  return path !== null && (path === folder || path.startsWith(`${folder} /`));
}

/* ---------------------------------- page ---------------------------------- */

const config = ARTIFACTS.bookmarks;
/** A URL-named row this page has not loaded is read by its reference. */
const ROW_LOOKUP: RowLookupSource = { route: config.route };

export function BookmarksPage() {
  const lists = useCommitStateLists<Finding>(
    config.route,
    BOOKMARK_PARAMETERS,
    {
      drain: BOOKMARK_ROW_CAP,
    },
  );
  // Saved / Recovered, the search and the open row live in the URL: Back
  // and a refresh keep them. The profile pick is the Case-wide lens.
  const [view, setView] = useViewTab();
  const [search, setSearch] = useViewSearch();
  // The folder pick is in the URL (`filter`), so refresh and Back keep it.
  const [folderFilter, setFolderFilter] = useViewFilter();
  const coverage = useArtifactCoverage(config.completenessArtifact);
  const treeBeside = useMediaQuery(LG_UP);

  const allSaved = useMemo(
    () => lists.saved.rows.map(toRow),
    [lists.saved.rows],
  );
  const allRecovered = useMemo(
    () => lists.recovered.rows.map(toRow),
    [lists.recovered.rows],
  );
  const loaded = useMemo(
    () => [...lists.saved.rows, ...lists.recovered.rows],
    [lists.saved.rows, lists.recovered.rows],
  );
  const sheet = useRowSelection(loaded, ROW_LOOKUP);
  const lens = useProfileLens(
    useMemo(() => [...new Set(loaded.map((row) => row.profile))], [loaded]),
  );
  // The profile lens narrows the figures and the folder tree too; the
  // folder and the search narrow only the lists.
  const saved = useMemo(
    () => allSaved.filter((row) => lens.applies(row.finding.profile)),
    [allSaved, lens],
  );
  const recovered = useMemo(
    () => allRecovered.filter((row) => lens.applies(row.finding.profile)),
    [allRecovered, lens],
  );

  const summary = useMemo(() => {
    const folders = new Set<string>();
    const hosts = new Set<string>();
    let backup = 0;
    for (const row of saved) {
      if (row.folderPath !== null) {
        folders.add(row.folderPath);
      }
      // A site as Sites keys it (the hostname, lower case).
      const site = siteHostKey(row.url);
      if (site !== null) {
        hosts.add(site);
      }
      if (isBackupSource(row.source)) {
        backup += 1;
      }
    }
    return {
      total: saved.length,
      folders: folders.size,
      hosts: hosts.size,
      backup,
    };
  }, [saved]);

  const narrow = useCallback(
    (rows: readonly BookmarkRow[]) =>
      rows.filter(
        (row) =>
          (folderFilter === null || inFolder(row, folderFilter)) &&
          matchesSearch(search, [row.name, row.url, row.folderPath]),
      ),
    [search, folderFilter],
  );
  const savedVisible = useMemo(() => narrow(saved), [narrow, saved]);
  const recoveredVisible = useMemo(
    () => narrow(recovered),
    [narrow, recovered],
  );

  const pickFolder = useCallback((path: string | null) => {
    setFolderFilter((current) =>
      path === null || current === path ? null : path,
    );
  }, []);

  const status = commitStateStatus(lists, {
    saved: saved.length,
    recovered: recovered.length,
  });
  const figuresReady = status.figures !== "loading";
  const capped = status.capped;
  const filteredMessage = (noun: string) =>
    search.trim() === "" && folderFilter === null && lens.words !== null
      ? `No ${noun} in ${lens.words}.`
      : undefined;

  const listPanel = (
    <SectionPanel
      id="bookmarks-list"
      className="min-w-0"
      title={folderFilter ?? "All bookmarks"}
      aside={
        folderFilter === null ? undefined : (
          <Button
            variant="tertiary"
            size="compact"
            onClick={() => {
              setFolderFilter(null);
            }}
          >
            Show all folders
          </Button>
        )
      }
    >
      <CommitStateSplit
        value={view}
        onValueChange={setView}
        label="Saved or recovered bookmarks"
        {...status.split}
        toolbar={
          <>
            <CompactFilters
              active={
                (folderFilter === null ? 0 : 1) +
                (lens.selected.length > 0 ? 1 : 0)
              }
            >
              {treeBeside || !figuresReady || saved.length === 0 ? null : (
                <FolderSelect
                  rows={saved}
                  activePath={folderFilter}
                  onPick={pickFolder}
                />
              )}
              {lens.showPicker ? (
                <FilterField label="Profiles" htmlFor="bookmarks-profiles">
                  <ProfilePicker
                    id="bookmarks-profiles"
                    profiles={lens.options}
                    selected={lens.selected}
                    onChange={lens.setSelected}
                  />
                </FilterField>
              ) : null}
            </CompactFilters>
            <FilterTextField
              commit="change"
              label="Search loaded bookmarks"
              placeholder="Search name, URL, or folder"
              icon={SearchIcon}
              value={search}
              onCommit={setSearch}
            />
          </>
        }
        saved={
          <BookmarkList
            list={lists.saved}
            rows={allSaved}
            visible={savedVisible}
            noun="saved"
            onSelect={sheet.select}
            onClearFilters={clearSearchAndProfiles}
            filteredMessage={filteredMessage("saved bookmarks")}
          />
        }
        recovered={
          <BookmarkList
            list={lists.recovered}
            rows={allRecovered}
            visible={recoveredVisible}
            noun="recovered"
            onSelect={sheet.select}
            onClearFilters={clearSearchAndProfiles}
            filteredMessage={filteredMessage("recovered bookmarks")}
          />
        }
      />
    </SectionPanel>
  );

  // The folder navigator sits beside the rows it focuses (the structure
  // the person built, next to what they filed) while the figures show.
  const navigator =
    status.figures !== "hide" && treeBeside ? (
      <div className="grid grid-cols-[260px_minmax(0,1fr)] items-start gap-4">
        <RevealSwap
          className="sticky top-14"
          loading={!figuresReady}
          skeleton={
            <div role="status">
              <span className="sr-only">Loading bookmark folders</span>
              <Skeleton className="h-[240px] w-full rounded-xl" />
            </div>
          }
        >
          <FolderNavigator
            rows={saved}
            activePath={folderFilter}
            onPick={pickFolder}
          />
        </RevealSwap>
        {listPanel}
      </div>
    ) : (
      listPanel
    );

  return (
    <CommitStatePage
      status={status}
      empty={
        <ArtifactEmpty
          icon={ARTIFACT_ICONS.bookmarks}
          coverage={emptyCoverageOf(coverage)}
          artifact="Bookmarks"
          title="No bookmarks"
          what="bookmarks"
          sidecars={false}
          pivot={<EmptyPivot page="top-sites">Open Top sites</EmptyPivot>}
        />
      }
      figuresSkeleton={<BookmarksSkeleton />}
      figures={
        <div className="flex flex-col gap-5">
          {capped ? (
            <Banner status="warning" contrast="high">
              <BannerTitle>These figures cover part of the Case</BannerTitle>
              <BannerDescription>
                They read the first {allSaved.length.toLocaleString("en-US")}{" "}
                saved bookmarks - the most this page loads at once. More rows
                exist in the Case.
              </BannerDescription>
            </Banner>
          ) : null}

          <MetricBand className="grid-cols-2 lg:grid-cols-4">
            <MetricBandItem
              label="Saved bookmarks"
              value={`${summary.total.toLocaleString("en-US")}${capped ? "+" : ""}`}
            />
            <MetricBandItem
              label="Folders"
              value={summary.folders.toLocaleString("en-US")}
            />
            <MetricBandItem
              label="Distinct sites"
              value={summary.hosts.toLocaleString("en-US")}
            />
            <MetricBandItem
              label={
                <Term label="From backup">
                  Read from Bookmarks.bak, the backup copy Chrome keeps beside
                  the live file.
                </Term>
              }
              value={summary.backup.toLocaleString("en-US")}
            />
          </MetricBand>
        </div>
      }
      sheet={
        sheet.selected === null ? null : (
          <RowSheet
            selected={sheet.selected}
            title={fieldText(sheet.selected.row.fields.name) ?? "Bookmark"}
            onClose={sheet.close}
          />
        )
      }
    >
      {navigator}
    </CommitStatePage>
  );
}
