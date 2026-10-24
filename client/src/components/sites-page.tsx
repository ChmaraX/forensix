/**
 * The Sites page.
 *
 * A host-centric read of the evidence, as a master–detail pair: every
 * observed host on the left, ordered by how much saved evidence it carries,
 * as an FF card list (one fluid hover highlight, the selected host holding
 * the selection fill); on the right the selected host's records, grouped
 * per evidence kind - each group a compact list of the columns an examiner
 * reads first (title over URL, cookie over path, file over source), not a
 * union of every wire field. Every technical field stays reachable through
 * the row detail sheet.
 *
 * From `md` up both panes stick under the topbar and scroll on their own,
 * so a host picked far down the list shows its evidence in view; with no
 * host in the URL the most-evidenced host is on show (the list's first).
 * Below `md` the two are one screen at a time: the host list, then the host
 * with a way back.
 *
 * Kinds: the six the Sites route groups (visits, cookies, saved logins,
 * form data, bookmarks, top sites), plus Downloads, Cache and Favicons, read
 * from their own routes with the host as a search and kept only when a
 * recorded URL is on exactly this host (`hostFieldsOf`; the "Host in"
 * column names the field). The host list counts what the Sites route
 * groups; the three added kinds show in the host's detail.
 *
 * Presentation rules kept: hosts and counts are grouped records, never
 * inference; states are worded, never colour alone; a field without its own
 * recorded value shows its own word ("(empty)", "absent", "unavailable");
 * within each kind, rows recovered from the WAL / rollback journal are a
 * separate list from saved rows (the stacked CommitStateSplit, State column
 * only there), never sorted in.
 */
import { useCallback, useContext, useMemo, useRef } from "react";

import {
  useRowSelection,
  useViewFilter,
  useViewHost,
  useViewSearch,
} from "../view-state.js";

import { Panel, PanelHeader, PanelTitle } from "@/components/panel";
import { Banner, BannerDescription, BannerTitle } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import {
  ARTIFACT_ICONS,
  ChevronLeftIcon,
  SearchIcon,
  type AppIcon,
} from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { useShape } from "@/lib/shape-context";
import { SizeProvider, typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import type { QueryParameters } from "../api.js";
import { fieldLabel } from "../field-labels.js";
import { useDrain } from "../use-commit-state-lists.js";
import { usePaginatedList } from "../use-paginated-list.js";
import type {
  Finding,
  SiteArtifactKind,
  SiteFinding,
  SiteHost,
} from "../types.js";
import { cacheResourceUrl } from "./cache-keys.js";
import { EmptyRows } from "./data-table.js";
import { fileNameOf } from "./downloads-model.js";
import { DownloadState } from "./downloads-table.js";
import { FaviconBitmapsContext, ResolutionCell } from "./favicons-fields.js";
import {
  FieldCell,
  fieldInteger,
  fieldText,
  SiteAvatar,
  StateWord,
  TwoLineCell,
  profileLabel,
} from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
import { formFieldLabel } from "./form-data.js";
import { ErrorRows, LoadingRows } from "./list-states.js";
import {
  CARD_TITLE_CLEAR,
  CommitStateSplit,
  Count,
  CountChips,
  type CountChip,
  formatBytes,
  IconTile,
  plural,
  ResponsiveRows,
  type RowColumn,
  splitByCommit,
  TimeCell,
} from "./page-kit.js";
import { RowSheet, SecretValueCell, secretFieldsOf } from "./row-sheet.js";
import { useOwnBitmaps } from "./site-favicons.js";
import { hostFieldsOf } from "./sites-host-fields.js";
import { useHostFavicons } from "./sites-hosts.js";
import { useMediaQuery } from "./use-media-query.js";

/** Tailwind's `md` breakpoint (48rem): the two panes side by side. */
const MD_UP = "(min-width: 48rem)";

/** Every evidence kind of a host: the six the Sites route groups, and the
 *  three read from their own routes by exact host. */
type SiteKind = SiteArtifactKind | "downloads" | "cache" | "favicons";

/** A row of the host's detail: its kind, and - for the three kinds read by
 *  exact host - the fields that put it on the host. */
type SiteRow = Finding & {
  readonly artifactKind: SiteKind;
  readonly hostFields?: readonly string[];
};

/**
 * Reading order, labels, nouns, and icons for every kind, in the order the
 * host summary, the kind chips and the panels follow: activity first, then
 * stored identity data, then the browser's traces of the site.
 */
const KIND_META: readonly {
  readonly kind: SiteKind;
  readonly label: string;
  /** The row noun for a count ("1 visit", "2 visits"). */
  readonly one: string;
  readonly many: string;
  readonly icon: AppIcon;
}[] = [
  {
    kind: "visits",
    label: "Visits",
    one: "visit",
    many: "visits",
    icon: ARTIFACT_ICONS.history,
  },
  {
    kind: "downloads",
    label: "Downloads",
    one: "download",
    many: "downloads",
    icon: ARTIFACT_ICONS.downloads,
  },
  {
    kind: "cookies",
    label: "Cookies",
    one: "cookie",
    many: "cookies",
    icon: ARTIFACT_ICONS.cookies,
  },
  {
    kind: "saved_logins",
    label: "Saved logins",
    one: "saved login",
    many: "saved logins",
    icon: ARTIFACT_ICONS.credentials,
  },
  {
    kind: "form_data",
    label: "Form data",
    one: "form entry",
    many: "form entries",
    icon: ARTIFACT_ICONS.autofill,
  },
  {
    kind: "bookmarks",
    label: "Bookmarks",
    one: "bookmark",
    many: "bookmarks",
    icon: ARTIFACT_ICONS.bookmarks,
  },
  {
    kind: "top_sites",
    label: "Top sites",
    one: "top site",
    many: "top sites",
    icon: ARTIFACT_ICONS["top-sites"],
  },
  {
    kind: "favicons",
    label: "Favicons",
    one: "favicon",
    many: "favicons",
    icon: ARTIFACT_ICONS.favicons,
  },
  {
    kind: "cache",
    label: "Cache",
    one: "cache entry",
    many: "cache entries",
    icon: ARTIFACT_ICONS.cache,
  },
];

type KindMeta = (typeof KIND_META)[number];

/** The kinds the Sites route counts per host (the host list's summary). */
const ROUTE_KINDS: ReadonlySet<SiteKind> = new Set<SiteArtifactKind>([
  "visits",
  "cookies",
  "saved_logins",
  "bookmarks",
  "top_sites",
  "form_data",
]);

/** The row sheet's title: the singular of the row's kind (a download: its
 *  file name). */
const KIND_SINGULAR: Readonly<Record<SiteKind, string>> = {
  visits: "Page visit",
  downloads: "Download",
  cookies: "Cookie",
  saved_logins: "Saved login",
  form_data: "Form entry",
  bookmarks: "Bookmark",
  top_sites: "Top site",
  favicons: "Favicon",
  cache: "Cache entry",
};

function sheetTitle(row: SiteRow): string {
  if (row.artifactKind === "downloads") {
    return fileNameOf(fieldText(row.fields.targetPath)) ?? "Download";
  }
  return KIND_SINGULAR[row.artifactKind];
}

/** Saved rows a host carries (every kind the route counts): the host list's
 *  count. Recovered rows are never summed in; they show in the host's own
 *  lists. */
function savedTotalOf(host: SiteHost): number {
  return Object.values(host.savedCounts).reduce((sum, count) => sum + count, 0);
}

function rowsTotalOf(host: SiteHost): number {
  return Object.values(host.counts).reduce((sum, count) => sum + count, 0);
}

/** Rows read per page (the routes' maximum). */
const SITE_PAGE_LIMIT = 100;
/** Most hosts, or one host's rows of one kind, the page reads before saying
 *  it stopped. */
const SITE_ROW_CAP = 5_000;

/**
 * One list, read page after page (`nextCursor`) up to `SITE_ROW_CAP` rows
 * so the counts and groups cover the whole set; `complete` is false when
 * the cap stopped it. Built on `usePaginatedList`, so a stale page never
 * lands after the host or search changed, and Retry resumes the failed page.
 */
function useSiteList<Row>(
  route: string,
  parameters: readonly (readonly [string, string])[],
) {
  const key = JSON.stringify(parameters);
  const withLimit = useMemo<QueryParameters>(
    () => [...parameters, ["limit", String(SITE_PAGE_LIMIT)]],
    // `key` stands in for `parameters`, whose identity changes every render.
    [key],
  );
  const list = usePaginatedList<Row>(route, withLimit);
  const settled = useDrain(list, SITE_ROW_CAP);
  return {
    rows: list.rows,
    // Loading until every page is in (or the cap / a failure stops it).
    loading: !settled && list.error === null,
    error: list.error,
    retry: list.retry,
    complete: settled && list.cursor === null,
  };
}

/* -------------------------------- host list -------------------------------- */

/** "4 visits · 1 cookie" - the saved rows the route counts for a host, in
 *  reading order; "Recovered rows only" when it has no saved row at all. */
function hostSummary(host: SiteHost): string {
  const saved = KIND_META.filter(
    (meta) =>
      ROUTE_KINDS.has(meta.kind) &&
      host.savedCounts[meta.kind as SiteArtifactKind] > 0,
  );
  if (saved.length === 0) {
    return "Recovered rows only";
  }
  return saved
    .map((meta) =>
      plural(
        host.savedCounts[meta.kind as SiteArtifactKind],
        meta.one,
        meta.many,
      ),
    )
    .join(" · ");
}

function HostListSkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading observed hosts"
      className="reveal-items flex flex-col gap-1 p-1"
    >
      {[0, 1, 2, 3, 4, 5].map((index) => (
        <div key={index} className="flex h-[60px] items-center gap-2.5 px-3">
          <Skeleton className="size-7 rounded-md" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-3/5" />
            <Skeleton className="h-2.5 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The card's accessible name (also how "All hosts" finds it again). */
function hostCardLabel(host: SiteHost): string {
  return `Show evidence for ${host.host}: ${plural(savedTotalOf(host), "saved row", "saved rows")}`;
}

/**
 * The master list: an FF CardGroup of inline cards, one per host. The fluid
 * highlight previews the host under the pointer; the selected host keeps the
 * selection fill and its CardTitle gains weight without reflow (FF's own
 * ghost-span title). The avatar holds the host's recovered favicon when the
 * Case has one (`site-favicons`), else its letter.
 */
function HostList({
  hosts,
  loading,
  error,
  onRetry,
  search,
  onSearch,
  selected,
  onSelect,
  icons,
  className,
  complete,
}: {
  readonly hosts: readonly SiteHost[];
  /** False when the read stopped at `SITE_ROW_CAP` hosts. */
  readonly complete: boolean;
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly selected: string | null;
  readonly onSelect: (host: string) => void;
  readonly icons: ReadonlyMap<string, string>;
  readonly className?: string;
}) {
  const shape = useShape();
  return (
    <Panel
      role="region"
      aria-labelledby="sites-hosts-title"
      className={cn("overflow-clip md:sticky md:top-16", className)}
    >
      <PanelHeader className="items-center pb-3">
        <div className="flex items-center gap-2">
          <PanelTitle id="sites-hosts-title">Observed hosts</PanelTitle>
          <Count>
            {`${hosts.length.toLocaleString("en-US")}${complete ? "" : "+"}`}
          </Count>
        </div>
      </PanelHeader>
      <SizeProvider size="compact">
        <div className="border-b border-border px-3 pb-3">
          <FilterTextField
            label="Search observed hosts"
            icon={SearchIcon}
            placeholder="Search hosts"
            value={search}
            onCommit={onSearch}
            className="w-full"
          />
        </div>
      </SizeProvider>
      {error !== null ? (
        <ErrorRows
          title="The observed hosts could not be loaded."
          message={error}
          onRetry={onRetry}
        />
      ) : loading && hosts.length === 0 ? (
        <HostListSkeleton />
      ) : hosts.length === 0 ? (
        <EmptyRows
          message={
            search.trim() === ""
              ? "No observed hosts in this Case."
              : `No observed host contains "${search.trim()}".`
          }
          action={
            search.trim() === "" ? undefined : (
              <Button
                variant="tertiary"
                size="compact"
                onClick={() => {
                  onSearch("");
                }}
              >
                Clear search
              </Button>
            )
          }
        />
      ) : (
        <div className="scroll-fade p-1 md:max-h-[calc(100dvh-13rem)] md:overflow-y-auto">
          <SizeProvider size="compact">
            <CardGroup orientation="inline">
              {hosts.map((item) => (
                <Card
                  key={item.host}
                  label={hostCardLabel(item)}
                  selected={selected === item.host}
                  onClick={() => {
                    onSelect(item.host);
                  }}
                  // A card in a group has no corner of its own, so its
                  // keyboard ring was square around the rounded selection
                  // fill; the fill's radius gives the ring the same corner.
                  className={shape.container}
                >
                  <SiteAvatar host={item.host} src={icons.get(item.host)} />
                  {/* The total (the list's order) is no unlabelled number
                      beside the card: it leads the summary's tooltip, and
                      the summary gets the width - up to two lines, so a
                      host with several kinds reads whole. */}
                  <CardHeader>
                    <CardTitle className={CARD_TITLE_CLEAR} title={item.host}>
                      {item.host}
                    </CardTitle>
                    <CardDescription
                      className={cn(typeClass("caption"), "line-clamp-2")}
                      title={`${plural(savedTotalOf(item), "saved row", "saved rows")}: ${hostSummary(item)}`}
                    >
                      {hostSummary(item)}
                    </CardDescription>
                  </CardHeader>
                </Card>
              ))}
            </CardGroup>
          </SizeProvider>
        </div>
      )}
    </Panel>
  );
}

/* ------------------------- per-kind curated tables ------------------------- */

type KindColumn = RowColumn<SiteRow>;

const timeColumn = (
  key: string,
  header: string,
  field: string,
  stack: "lead" | "meta" = "meta",
): KindColumn => ({
  key,
  header,
  className: "w-[184px] whitespace-nowrap",
  stack,
  labelled: stack === "meta",
  cell: (row) => <TimeCell field={row.fields[field]} />,
});

const stackedColumn = (
  header: string,
  primary: string,
  secondary: string,
  prose = false,
): KindColumn => ({
  key: "main",
  header,
  // Narrow enough that the Recovered list's State word still fits beside
  // the dates at 1440.
  className: "max-w-[320px] min-w-[180px]",
  stack: "title",
  cell: (row) => (
    <TwoLineCell
      primary={row.fields[primary]}
      secondary={row.fields[secondary]}
      mono={prose ? false : "auto"}
    />
  ),
});

/** "URL chain, Referrer": the fields that put the row on this host - meta,
 *  so a caption that wraps rather than cuts a field name off. */
const HOST_IN_COLUMN: KindColumn = {
  key: "host-in",
  header: "Host in",
  className: "w-[132px] min-w-[132px]",
  labelled: true,
  cell: (row) => <HostInCell row={row} />,
  stackedCell: (row) =>
    (row.hostFields ?? [])
      .map((name) => fieldLabel(name, row.findingKind))
      .join(", "),
};

function HostInCell({ row }: { readonly row: SiteRow }) {
  return (
    <span
      className={cn(
        typeClass("caption"),
        "flex flex-col text-muted-foreground",
      )}
    >
      {(row.hostFields ?? []).map((name) => (
        <span key={name} className="whitespace-nowrap">
          {fieldLabel(name, row.findingKind)}
        </span>
      ))}
    </span>
  );
}

/** Received bytes, with the expected total beside them when the transfer
 *  stopped short ("9.4 MB of 28.2 MB"): never the total alone, which would
 *  overstate what arrived. */
function ReceivedCell({ row }: { readonly row: SiteRow }) {
  const received = fieldInteger(row.fields.receivedBytes);
  if (received === null) {
    return <FieldCell field={row.fields.receivedBytes} />;
  }
  const total = fieldInteger(row.fields.totalBytes);
  const short = total !== null && total > 0 && total !== received;
  return (
    <span
      className="whitespace-nowrap"
      title={
        short
          ? `${received.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} bytes received`
          : `${received.toLocaleString("en-US")} bytes received`
      }
    >
      {formatBytes(received)}
      {short ? (
        <span className="text-muted-foreground">{` of ${formatBytes(total)}`}</span>
      ) : null}
    </span>
  );
}

/** A favicon's own stored bitmap (when its bytes hash to the row's
 *  `payloadSha256`) beside its icon URL. */
function FaviconCell({ row }: { readonly row: SiteRow }) {
  const bitmaps = useContext(FaviconBitmapsContext);
  const sha = fieldText(row.fields.payloadSha256);
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <SiteAvatar
        host={null}
        src={sha === null ? null : (bitmaps.get(sha) ?? null)}
      />
      <span className="min-w-0 flex-1">
        <FieldCell field={row.fields.iconUrl} mono />
      </span>
    </span>
  );
}

/**
 * The columns per kind, chosen for reading, not completeness: the host is
 * already fixed by the selection, so cells carry what tells rows apart
 * within it. Below `sm` the time (or rank) leads each stacked row.
 */
const KIND_COLUMNS: Readonly<Record<SiteKind, readonly KindColumn[]>> = {
  visits: [
    timeColumn("time", "Time", "visitTime", "lead"),
    stackedColumn("Page", "title", "url", true),
  ],
  downloads: [
    {
      key: "file",
      header: "File",
      className: "max-w-[300px] min-w-[180px]",
      stack: "title",
      cell: (row) => {
        const name = fileNameOf(fieldText(row.fields.targetPath));
        return (
          <TwoLineCell
            primary={name ?? row.fields.targetPath}
            secondary={row.fields.originalUrl}
            mono={name === null ? "auto" : false}
          />
        );
      },
    },
    {
      key: "outcome",
      header: "Outcome",
      className: "w-[120px] whitespace-nowrap",
      stack: "aside",
      cell: (row) => <DownloadState field={row.fields.state} />,
    },
    {
      key: "received",
      header: "Received",
      className: "w-[150px] text-right whitespace-nowrap tabular-nums",
      labelled: true,
      cell: (row) => <ReceivedCell row={row} />,
    },
    timeColumn("started", "Started", "startTime", "lead"),
    HOST_IN_COLUMN,
  ],
  cookies: [
    stackedColumn("Cookie", "name", "path"),
    timeColumn("created", "Created", "creationTime", "lead"),
    timeColumn("expires", "Expires", "expiresTime"),
  ],
  saved_logins: [
    stackedColumn("Username", "usernameValue", "signonRealm"),
    timeColumn("created", "Created", "dateCreated"),
    timeColumn("last-used", "Last used", "dateLastUsed", "lead"),
  ],
  form_data: [
    {
      key: "field",
      header: "Field",
      className: "max-w-[220px] text-foreground",
      stack: "title",
      // The shared field-name label (as on Form data and the Timeline);
      // the row sheet keeps the raw recorded name.
      cell: (row) => {
        const label = formFieldLabel(fieldText(row.fields.fieldName));
        return label === null ? (
          <FieldCell field={row.fields.fieldName} />
        ) : (
          <span className="block truncate" title={label}>
            {label}
          </span>
        );
      },
    },
    {
      key: "value",
      header: "Value",
      className: "max-w-[300px]",
      labelled: true,
      // A Payment value stays hidden here; the row sheet reveals it.
      cell: (row) => (
        <SecretValueCell
          field={row.fields.fieldValue}
          reveal={!secretFieldsOf(row).includes("fieldValue")}
          hint="Open the row to reveal it."
        />
      ),
    },
    timeColumn("last-used", "Last used", "dateLastUsed", "lead"),
  ],
  bookmarks: [
    stackedColumn("Bookmark", "name", "url", true),
    {
      key: "folder",
      header: "Folder",
      className: "max-w-[220px]",
      cell: (row) => <FieldCell field={row.fields.folderPath} mono={false} />,
    },
    timeColumn("added", "Added", "dateAdded", "lead"),
  ],
  top_sites: [
    {
      key: "rank",
      header: "Rank",
      className: "w-16 text-right tabular-nums",
      stack: "lead",
      cell: (row) => (
        <FieldCell
          field={row.fields.urlRank}
          format={(value) => String(value)}
        />
      ),
      stackedCell: (row) => (
        <FieldCell
          field={row.fields.urlRank}
          format={(value) => `Rank ${String(value)}`}
        />
      ),
    },
    stackedColumn("Site", "title", "url", true),
  ],
  favicons: [
    {
      key: "icon",
      header: "Icon",
      className: "max-w-[320px] min-w-[180px]",
      stack: "title",
      cell: (row) => <FaviconCell row={row} />,
    },
    {
      key: "resolution",
      header: "Resolution",
      className: "w-[104px] whitespace-nowrap tabular-nums",
      labelled: true,
      cell: (row) => <ResolutionCell row={row} />,
    },
    HOST_IN_COLUMN,
    timeColumn("updated", "Last updated", "lastUpdated", "lead"),
  ],
  cache: [
    {
      key: "resource",
      header: "Resource",
      className: "max-w-[420px] min-w-[200px]",
      stack: "title",
      cell: (row) => {
        // The key's resource URL (the scope prefix, if any, stays in the
        // row sheet's Key field).
        const url = cacheResourceUrl(fieldText(row.fields.key));
        return url === null ? (
          <FieldCell field={row.fields.key} mono />
        ) : (
          <span className="block truncate font-mono" title={url}>
            {url}
          </span>
        );
      },
    },
    {
      key: "size",
      header: "Size",
      className: "w-[96px] text-right whitespace-nowrap tabular-nums",
      labelled: true,
      cell: (row) => {
        const bytes =
          fieldInteger(row.fields.entrySizeBytes) ??
          fieldInteger(row.fields.stream1Size);
        return bytes === null ? (
          <FieldCell field={row.fields.entrySizeBytes} />
        ) : (
          <span title={`${bytes.toLocaleString("en-US")} bytes`}>
            {formatBytes(bytes)}
          </span>
        );
      },
    },
    timeColumn("last-used", "Last used", "lastUsed", "lead"),
  ],
};

const PROFILE_COLUMN: KindColumn = {
  key: "profile",
  header: "Profile",
  className: "w-[136px] whitespace-nowrap",
  cell: (row) => profileLabel(row.profile),
};

const STATE_COLUMN: KindColumn = {
  key: "state",
  header: "State",
  stack: "aside",
  cell: (row) => <StateWord state={row.commitState} />,
};

/** Every column set a kind table can take, built once so the rows stay
 *  memoised (`ResponsiveRows` re-renders a row only when its props
 *  change). */
const COLUMN_SETS = new Map<string, readonly KindColumn[]>(
  KIND_META.flatMap((meta) =>
    [false, true].flatMap((profile) =>
      [false, true].map((recovered): [string, readonly KindColumn[]] => [
        `${meta.kind}:${String(profile)}:${String(recovered)}`,
        [
          ...KIND_COLUMNS[meta.kind],
          ...(profile ? [PROFILE_COLUMN] : []),
          ...(recovered ? [STATE_COLUMN] : []),
        ],
      ]),
    ),
  ),
);

const kindRowKey = (row: SiteRow, index: number) =>
  `${row.commitState}:${row.profile}:${row.provenance.table ?? ""}:${row.provenance.rowId ?? ""}:${String(index)}`;

/** The recorded value a row is read by, per kind (its accessible name). */
const ROW_NAME_FIELDS: Readonly<Record<SiteKind, readonly string[]>> = {
  visits: ["title", "url"],
  downloads: [],
  cookies: ["name"],
  saved_logins: ["usernameValue", "signonRealm"],
  form_data: [],
  bookmarks: ["name", "url"],
  top_sites: ["title", "url"],
  favicons: ["iconUrl"],
  cache: ["key"],
};

/** "Open download detail: teamviewer_setup.exe". */
function rowLabelOf(meta: KindMeta): (row: SiteRow) => string {
  return (row) => {
    const name =
      meta.kind === "downloads"
        ? fileNameOf(fieldText(row.fields.targetPath))
        : meta.kind === "form_data"
          ? formFieldLabel(fieldText(row.fields.fieldName))
          : meta.kind === "cache"
            ? cacheResourceUrl(fieldText(row.fields.key))
            : (ROW_NAME_FIELDS[meta.kind]
                .map((field) => fieldText(row.fields[field]))
                .find((text) => text !== null) ?? null);
    return `Open ${meta.one} detail${name === null ? "" : `: ${name}`}`;
  };
}

const KIND_ROW_LABELS = new Map<SiteKind, (row: SiteRow) => string>(
  KIND_META.map((meta) => [meta.kind, rowLabelOf(meta)]),
);

function KindTable({
  kind,
  rows,
  recovered,
  showProfile,
  onSelect,
}: {
  readonly kind: SiteKind;
  readonly rows: readonly SiteRow[];
  /** The recovered list: adds the State column. */
  readonly recovered: boolean;
  /** The host's rows span more than one profile: adds the Profile column. */
  readonly showProfile: boolean;
  readonly onSelect: (row: SiteRow) => void;
}) {
  return (
    <ResponsiveRows
      rows={rows}
      columns={
        COLUMN_SETS.get(
          `${kind}:${String(showProfile)}:${String(recovered)}`,
        ) ?? KIND_COLUMNS[kind]
      }
      rowKey={kindRowKey}
      rowLabel={KIND_ROW_LABELS.get(kind)}
      onSelect={onSelect}
      tableClassName="tabular-nums"
    />
  );
}

/**
 * One evidence kind for the selected host: its saved rows, then - as a
 * separate list with its own heading - any rows recovered from a sidecar.
 */
function KindPanel({
  meta,
  rows,
  onSelect,
}: {
  readonly meta: KindMeta;
  readonly rows: readonly SiteRow[];
  readonly onSelect: (row: SiteRow) => void;
}) {
  const { saved, recovered } = useMemo(() => splitByCommit(rows), [rows]);
  // The Profile column only when this kind's rows span more than one.
  const showProfile = new Set(rows.map((row) => row.profile)).size > 1;
  const titleId = `sites-kind-${meta.kind}`;
  return (
    <Panel role="region" aria-labelledby={titleId} className="overflow-clip">
      <PanelHeader className="items-center pb-2">
        <div className="flex items-center gap-3">
          <IconTile icon={meta.icon} />
          {/* Under the host's h2: a third-level heading. */}
          <PanelTitle id={titleId} as="h3">
            {meta.label}
          </PanelTitle>
          <Count>{saved.length}</Count>
        </div>
      </PanelHeader>
      <CommitStateSplit
        variant="stacked"
        headingAs="h4"
        savedCount={saved.length}
        recoveredCount={recovered.length}
        saved={
          saved.length > 0 ? (
            <KindTable
              kind={meta.kind}
              rows={saved}
              recovered={false}
              showProfile={showProfile}
              onSelect={onSelect}
            />
          ) : (
            // Recovered rows only: one line, not a full empty state, so
            // the recovered list below stays the panel's content.
            <p
              className={cn(
                typeClass("body"),
                "px-4 pb-3 text-muted-foreground",
              )}
            >
              {`No saved ${meta.many} for this host.`}
            </p>
          )
        }
        recovered={
          <KindTable
            kind={meta.kind}
            rows={recovered}
            recovered
            showProfile={showProfile}
            onSelect={onSelect}
          />
        }
      />
    </Panel>
  );
}

/* ------------------------------- host detail ------------------------------- */

/** Stands in for the first kind panel while the host's rows load. */
function DetailSkeleton() {
  return (
    <Panel className="overflow-clip">
      <div className="flex items-center gap-3 px-4 pt-4 pb-2">
        <Skeleton className="size-8 rounded-lg" />
        <Skeleton className="h-3.5 w-24" />
      </div>
      <LoadingRows label="Loading the host's evidence" rows={4} />
    </Panel>
  );
}

/** The three kinds read from their own routes, with the host as a search
 *  (core matches it anywhere in the row's URLs) narrowed to exact hosts. */
const EXACT_KINDS: readonly {
  readonly kind: "downloads" | "cache" | "favicons";
  readonly route: string;
}[] = [
  { kind: "downloads", route: "downloads" },
  { kind: "favicons", route: "favicons" },
  { kind: "cache", route: "cache" },
];

function HostDetail({
  host,
  icon,
  onBack,
}: {
  readonly host: string;
  /** The host's recovered favicon (`data:` URI), when the Case has one. */
  readonly icon: string | undefined;
  /** Back to the host list (below `md`, where the two are one screen at a
   *  time). */
  readonly onBack: () => void;
}) {
  const wide = useMediaQuery(MD_UP);
  const findings = useSiteList<SiteFinding>("site-findings", [["host", host]]);
  const search: readonly (readonly [string, string])[] = [["search", host]];
  const downloads = useSiteList<Finding>("downloads", search);
  const favicons = useSiteList<Finding>("favicons", search);
  const cache = useSiteList<Finding>("cache", search);
  const exactReads = { downloads, favicons, cache };
  // The kind chip is in the URL (`filter`), so refresh and Back keep it.
  const [kindPick, setKindFilter] = useViewFilter();
  // The favicons' own bitmaps, matched by hash (as on the Favicons page).
  const bitmaps = useOwnBitmaps(useMemo(() => [host], [host]));

  const exactRows = useMemo(() => {
    const rows: SiteRow[] = [];
    for (const [kind, list] of [
      ["downloads", downloads.rows],
      ["favicons", favicons.rows],
      ["cache", cache.rows],
    ] as const) {
      for (const row of list) {
        const hostFields = hostFieldsOf(row, host);
        if (hostFields.length > 0) {
          rows.push({ ...row, artifactKind: kind, hostFields });
        }
      }
    }
    return rows;
  }, [downloads.rows, favicons.rows, cache.rows, host]);

  const allRows = useMemo<readonly SiteRow[]>(
    () => [...findings.rows, ...exactRows],
    [findings.rows, exactRows],
  );
  const sheet = useRowSelection(allRows);

  const grouped = useMemo(() => {
    const groups = new Map<SiteKind, SiteRow[]>();
    for (const row of allRows) {
      const group = groups.get(row.artifactKind) ?? [];
      group.push(row);
      groups.set(row.artifactKind, group);
    }
    return groups;
  }, [allRows]);

  const presentKinds = KIND_META.filter(
    (meta) => (grouped.get(meta.kind) ?? []).length > 0,
  );
  // A kind from the URL counts only when this host has rows of it.
  const kindFilter: SiteKind | null =
    presentKinds.find((meta) => meta.kind === kindPick)?.kind ?? null;
  // Every read has settled (or failed): the kinds, chips and panels land
  // together instead of shifting as each read arrives.
  const ready =
    !findings.loading &&
    EXACT_KINDS.every(({ kind }) => !exactReads[kind].loading);
  const failed = [
    ...(findings.error === null
      ? []
      : [
          {
            key: "site-findings",
            title:
              "This host's visits, cookies, logins, form data, bookmarks and top sites could not be loaded.",
            message: findings.error,
            retry: findings.retry,
          },
        ]),
    ...EXACT_KINDS.flatMap(({ kind }) => {
      const read = exactReads[kind];
      const label = KIND_META.find((meta) => meta.kind === kind)?.label ?? kind;
      return read.error === null
        ? []
        : [
            {
              key: kind,
              title: `This host's ${label.toLocaleLowerCase("en-US")} could not be loaded.`,
              message: read.error,
              retry: read.retry,
            },
          ];
    }),
  ];
  const incomplete =
    (findings.error === null && !findings.complete) ||
    EXACT_KINDS.some(({ kind }) => {
      const read = exactReads[kind];
      return read.error === null && !read.complete;
    });
  // The chips count saved rows, like each kind panel's count; recovered rows
  // stay in their own lists below.
  const savedIn = (rows: readonly SiteRow[]) =>
    rows.filter((row) => row.commitState === "committed").length;
  const recoveredTotal = allRows.length - savedIn(allRows);

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-5",
        // From `md` up the detail sticks under the topbar beside the host
        // list and scrolls on its own, so the evidence of a host picked
        // far down the list starts in view. Keyed by host, so a new host
        // starts at its top.
        wide &&
          "scroll-fade sticky top-16 -mx-1 max-h-[calc(100dvh-5rem)] overflow-y-auto px-1 pb-1",
      )}
    >
      <section
        aria-labelledby="sites-host-title"
        className="flex min-w-0 flex-col gap-3"
      >
        <SizeProvider size="compact">
          <Button
            variant="ghost"
            leadingIcon={ChevronLeftIcon}
            onClick={onBack}
            className="self-start md:hidden"
          >
            All hosts
          </Button>
        </SizeProvider>
        <div className="flex min-w-0 items-center gap-4 px-1">
          <SiteAvatar host={host} size="lg" src={icon} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2
              id="sites-host-title"
              className={cn(
                typeClass("title"),
                "min-w-0 truncate text-foreground",
              )}
              style={{ fontVariationSettings: fontWeights.semibold }}
              title={host}
            >
              {host}
            </h2>
            {/* What the host holds, once every read is in: saved rows
                across its kinds, recovered named beside, never summed. */}
            {ready && allRows.length > 0 ? (
              <p
                className={cn(
                  typeClass("caption"),
                  "text-muted-foreground tabular-nums",
                )}
              >
                {`${plural(savedIn(allRows), "saved row", "saved rows")} in ${plural(presentKinds.length, "kind", "kinds")}`}
                {recoveredTotal > 0
                  ? ` · ${plural(recoveredTotal, "recovered row", "recovered rows")}`
                  : ""}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      {failed.map((failure) => (
        <Panel key={failure.key}>
          <ErrorRows
            title={failure.title}
            message={failure.message}
            onRetry={failure.retry}
          />
        </Panel>
      ))}

      {ready && allRows.length === 0 && failed.length === 0 ? (
        <Panel>
          <EmptyRows message="No recorded rows for this host." />
        </Panel>
      ) : (
        <div className="reveal-swap">
          <DetailSkeleton />
          {ready ? (
            <FaviconBitmapsContext.Provider value={bitmaps}>
              <div className="flex flex-col gap-5">
                {incomplete ? (
                  <Banner status="info" contrast="high" size="compact">
                    <BannerTitle>
                      Not every row of this host is listed
                    </BannerTitle>
                    <BannerDescription>
                      {`Sites reads the first ${SITE_ROW_CAP.toLocaleString("en-US")} rows of each kind for a host; the artifact pages list the rest.`}
                    </BannerDescription>
                  </Banner>
                ) : null}
                {presentKinds.length > 1 ? (
                  <SizeProvider size="compact">
                    <CountChips
                      label="Evidence kind"
                      total={savedIn(allRows)}
                      chips={presentKinds.map(
                        (meta): CountChip => ({
                          key: meta.kind,
                          label: meta.label,
                          count: savedIn(grouped.get(meta.kind) ?? []),
                        }),
                      )}
                      active={kindFilter}
                      partial={incomplete}
                      onChange={(key) => {
                        setKindFilter(
                          presentKinds.find((meta) => meta.kind === key)
                            ?.kind ?? null,
                        );
                      }}
                    />
                  </SizeProvider>
                ) : null}
                <div
                  key={kindFilter ?? "all"}
                  className="reveal-items flex flex-col gap-5"
                >
                  {presentKinds
                    .filter(
                      (meta) => kindFilter === null || kindFilter === meta.kind,
                    )
                    .map((meta) => (
                      <KindPanel
                        key={meta.kind}
                        meta={meta}
                        rows={grouped.get(meta.kind) ?? []}
                        onSelect={sheet.select}
                      />
                    ))}
                </div>
              </div>
            </FaviconBitmapsContext.Provider>
          ) : null}
        </div>
      )}

      {sheet.selected === null ? null : (
        <RowSheet
          selected={sheet.selected}
          title={sheetTitle(sheet.selected.row)}
          redactedFields={secretFieldsOf(sheet.selected.row)}
          onClose={sheet.close}
        />
      )}
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

export function SitesPage() {
  // The host search lives in the URL (`q`): Back and a refresh keep it.
  const [search, setSearch] = useViewSearch();
  // The host on show lives in the URL (`host`): an Overview or Related link
  // opens Sites on it, and Back returns to the previous host.
  const [host, setHost] = useViewHost();
  const wide = useMediaQuery(MD_UP);
  const detailRef = useRef<HTMLDivElement>(null);
  const hosts = useSiteList<SiteHost>(
    "site-hosts",
    search.length === 0 ? [] : [["search", search]],
  );
  // Most saved evidence first (then every row, then the name): the route
  // pages hosts by name, so the order is set once every page is in.
  const sortedHosts = useMemo(
    () =>
      [...hosts.rows].sort(
        (left, right) =>
          savedTotalOf(right) - savedTotalOf(left) ||
          rowsTotalOf(right) - rowsTotalOf(left) ||
          (left.host < right.host ? -1 : left.host > right.host ? 1 : 0),
      ),
    [hosts.rows],
  );
  const shownHosts = useMemo(
    () => (hosts.loading ? [] : sortedHosts),
    [hosts.loading, sortedHosts],
  );
  const icons = useHostFavicons(
    useMemo(() => shownHosts.map((entry) => entry.host), [shownHosts]),
  );

  // With no host in the URL, from `md` up the most-evidenced host is on
  // show (the list's first) rather than an empty pane; below `md` the list
  // is the screen. The URL stays without a host, so Back still means
  // "before Sites".
  const onShow = host ?? (wide ? (shownHosts[0]?.host ?? null) : null);

  // Below `md` the list and the detail are one screen at a time: picking a
  // host swaps the list for its evidence, from the top. Where the list was
  // when a host was picked: "All hosts" puts the list back at that scroll
  // position with focus on that host's card.
  const listScroll = useRef(0);
  const pickHost = useCallback(
    (next: string) => {
      setHost(next);
      if (!wide) {
        listScroll.current = window.scrollY;
        requestAnimationFrame(() => {
          detailRef.current?.scrollIntoView({ block: "start" });
        });
      }
    },
    [setHost, wide],
  );
  const backToHosts = useCallback(() => {
    const previous = sortedHosts.find((entry) => entry.host === host);
    setHost(null);
    requestAnimationFrame(() => {
      window.scrollTo({ top: listScroll.current });
      if (previous !== undefined) {
        document
          .querySelector<HTMLElement>(
            `[aria-label="${CSS.escape(hostCardLabel(previous))}"]`,
          )
          ?.focus({ preventScroll: true });
      }
    });
  }, [host, setHost, sortedHosts]);

  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(240px,0.36fr)_minmax(0,1fr)]">
      <HostList
        hosts={shownHosts}
        complete={hosts.complete}
        loading={hosts.loading}
        error={hosts.error}
        onRetry={hosts.retry}
        search={search}
        onSearch={setSearch}
        selected={onShow}
        onSelect={pickHost}
        icons={icons}
        className={host === null ? undefined : "max-md:hidden"}
      />
      <div ref={detailRef} className="min-w-0 scroll-mt-16">
        {onShow === null ? (
          wide ? (
            // The list is loading (or empty): the pane holds its place.
            hosts.loading ? (
              <DetailSkeleton />
            ) : null
          ) : null
        ) : (
          <HostDetail
            key={onShow}
            host={onShow}
            icon={icons.get(onShow)}
            onBack={backToHosts}
          />
        )}
      </div>
    </div>
  );
}
