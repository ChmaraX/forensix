/**
 * The Sites page.
 *
 * A host-centric read of the evidence, as a master–detail pair: every
 * observed host on the left, ordered by how much recorded evidence it
 * carries, as an FF card list (one fluid hover highlight, the selected host
 * holding the selection fill); on the right the selected host's records,
 * grouped per artifact kind — each group a compact list of three or four
 * columns an examiner reads first (title over URL, cookie over path,
 * username over realm), not a union of every wire field. Every technical
 * field stays reachable through the row detail sheet. Below `md` the two
 * are one screen at a time: the host list, then the host with a way back.
 *
 * Presentation rules kept: hosts and counts are grouped records, never
 * inference; states are worded, never colour alone; a field without its own
 * recorded value shows its own word ("(empty)", "absent", "unavailable");
 * within each kind, rows recovered from the WAL / rollback journal are a
 * separate list from saved rows (the stacked CommitStateSplit, State column
 * only there), never sorted in.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useViewHost } from "../view-state.js";

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
import { useDrain } from "../use-commit-state-lists.js";
import { usePaginatedList } from "../use-paginated-list.js";
import type {
  Finding,
  SiteArtifactKind,
  SiteFinding,
  SiteHost,
} from "../types.js";
import {
  CARD_TITLE_CLEAR,
  CommitStateSplit,
  Count,
  CountChips,
  type CountChip,
  IconTile,
  plural,
  ResponsiveRows,
  type RowColumn,
  splitByCommit,
  TimeCell,
} from "./page-kit.js";
import { EmptyRows } from "./data-table.js";
import {
  FieldCell,
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
  RowSheet,
  SecretValueCell,
  secretFieldsOf,
  type SelectedRow,
} from "./row-sheet.js";

/**
 * Reading order, labels, nouns, and icons for the six site artifact kinds.
 * Order is investigative: activity first, then stored identity data.
 */
const KIND_META: readonly {
  readonly kind: SiteArtifactKind;
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
    kind: "form_data",
    label: "Form data",
    one: "form entry",
    many: "form entries",
    icon: ARTIFACT_ICONS.autofill,
  },
];

const KIND_LABELS: Readonly<Record<SiteArtifactKind, string>> =
  Object.fromEntries(
    KIND_META.map((meta) => [meta.kind, meta.label]),
  ) as Record<SiteArtifactKind, string>;

/** The row sheet's title: the singular of the row's artifact kind. */
const KIND_SINGULAR: Readonly<Record<SiteArtifactKind, string>> = {
  visits: "Page visit",
  cookies: "Cookie",
  saved_logins: "Saved login",
  bookmarks: "Bookmark",
  top_sites: "Top site",
  form_data: "Form entry",
};

function sheetTitle(row: Finding): string | undefined {
  const kind = (row as Partial<SiteFinding>).artifactKind;
  return kind === undefined ? undefined : KIND_SINGULAR[kind];
}

/** Saved rows a host carries (every kind): the host list's count. Recovered
 *  rows are never summed in; they show in the host's own lists. */
function savedTotalOf(host: SiteHost): number {
  return Object.values(host.savedCounts).reduce((sum, count) => sum + count, 0);
}

/** Rows read per Sites page (the routes' maximum). */
const SITE_PAGE_LIMIT = 100;
/** Most hosts, or one host's rows, the page reads before saying it stopped. */
const SITE_ROW_CAP = 5_000;

/**
 * One Sites list, read page after page (`nextCursor`) up to `SITE_ROW_CAP`
 * rows so the counts and groups cover the whole set; `complete` is false
 * when the cap stopped it. Built on `usePaginatedList`, so a stale page never
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

/** "4 visits · 1 cookie" — the saved rows a host carries, in reading order;
 *  "Recovered rows only" when it has no saved row at all. */
function hostSummary(host: SiteHost): string {
  const saved = KIND_META.filter((meta) => host.savedCounts[meta.kind] > 0);
  if (saved.length === 0) {
    return "Recovered rows only";
  }
  return saved
    .map((meta) => plural(host.savedCounts[meta.kind], meta.one, meta.many))
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

/**
 * The master list: an FF CardGroup of inline cards, one per host. The fluid
 * highlight previews the host under the pointer; the selected host keeps the
 * selection fill and its CardTitle gains weight without reflow (FF's own
 * ghost-span title).
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
            placeholder="Search hosts…"
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
              : "No observed hosts match this search."
          }
        />
      ) : (
        <div className="scroll-fade p-1 md:max-h-[calc(100dvh-13rem)] md:overflow-y-auto">
          <SizeProvider size="compact">
            <CardGroup orientation="inline">
              {hosts.map((item) => (
                <Card
                  key={item.host}
                  label={`Show evidence for ${item.host}: ${plural(savedTotalOf(item), "saved row", "saved rows")}`}
                  selected={selected === item.host}
                  onClick={() => {
                    onSelect(item.host);
                  }}
                  // A card in a group has no corner of its own, so its
                  // keyboard ring was square around the rounded selection
                  // fill; the fill's radius gives the ring the same corner.
                  className={shape.container}
                >
                  <SiteAvatar host={item.host} />
                  {/* The total (the list's order) is no unlabelled number
                      beside the card: it leads the summary's tooltip, and
                      the summary gets the width. */}
                  <CardHeader>
                    <CardTitle className={CARD_TITLE_CLEAR} title={item.host}>
                      {item.host}
                    </CardTitle>
                    <CardDescription
                      className={cn(typeClass("caption"), "truncate")}
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

type KindColumn = RowColumn<SiteFinding>;

const timeColumn = (
  key: string,
  header: string,
  field: string,
  stack: "lead" | "meta" = "meta",
): KindColumn => ({
  key,
  header,
  className: "whitespace-nowrap",
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
  // the dates at 1440 (the detail column is about 800px).
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

/**
 * Three or four columns per kind, chosen for reading, not completeness: the
 * host is already fixed by the selection, so cells carry what tells rows
 * apart within it. Below `sm` the time (or rank) leads each stacked row.
 */
const KIND_COLUMNS: Readonly<Record<SiteArtifactKind, readonly KindColumn[]>> =
  {
    visits: [
      timeColumn("time", "Time", "visitTime", "lead"),
      stackedColumn("Page", "title", "url", true),
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
  };

const PROFILE_COLUMN: KindColumn = {
  key: "profile",
  header: "Profile",
  className: "whitespace-nowrap",
  cell: (row) => profileLabel(row.profile),
};

const STATE_COLUMN: KindColumn = {
  key: "state",
  header: "State",
  stack: "aside",
  cell: (row) => <StateWord state={row.commitState} />,
};

function KindTable({
  kind,
  rows,
  recovered,
  showProfile,
  onSelect,
}: {
  readonly kind: SiteArtifactKind;
  readonly rows: readonly SiteFinding[];
  /** The recovered list: adds the State column. */
  readonly recovered: boolean;
  /** The host's rows span more than one profile: adds the Profile column. */
  readonly showProfile: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  const columns = [
    ...KIND_COLUMNS[kind],
    ...(showProfile ? [PROFILE_COLUMN] : []),
    ...(recovered ? [STATE_COLUMN] : []),
  ];
  return (
    <ResponsiveRows
      rows={rows}
      columns={columns}
      rowKey={(row, index) => `${row.commitState}:${String(index)}`}
      rowLabel={() => `Open ${KIND_LABELS[kind]} row detail`}
      onSelect={onSelect}
      tableClassName="tabular-nums"
    />
  );
}

/**
 * One artifact kind for the selected host: its saved rows, then — as a
 * separate list with its own heading — any rows recovered from a sidecar.
 */
function KindPanel({
  meta,
  rows,
  onSelect,
}: {
  readonly meta: (typeof KIND_META)[number];
  readonly rows: readonly SiteFinding[];
  readonly onSelect: (row: Finding) => void;
}) {
  const { saved, recovered } = splitByCommit(rows);
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
              No saved rows for this host.
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

function HostDetail({
  host,
  onSelect,
  onBack,
}: {
  readonly host: string;
  readonly onSelect: (row: Finding) => void;
  /** Back to the host list (below `md`, where the two are one screen at a
   *  time). */
  readonly onBack: () => void;
}) {
  const findings = useSiteList<SiteFinding>("site-findings", [["host", host]]);
  const [kindFilter, setKindFilter] = useState<SiteArtifactKind | null>(null);

  // Selecting another host resets the kind focus — the tabs describe the new
  // host's evidence, not the previous one's.
  useEffect(() => {
    setKindFilter(null);
  }, [host]);

  const grouped = useMemo(() => {
    const groups = new Map<SiteArtifactKind, SiteFinding[]>();
    for (const finding of findings.rows) {
      const group = groups.get(finding.artifactKind) ?? [];
      group.push(finding);
      groups.set(finding.artifactKind, group);
    }
    return groups;
  }, [findings.rows]);

  const presentKinds = KIND_META.filter(
    (meta) => (grouped.get(meta.kind) ?? []).length > 0,
  );
  const ready = !findings.loading;
  // The tabs count saved rows, like each kind panel's count; recovered rows
  // stay in their own lists below.
  const savedIn = (rows: readonly SiteFinding[]) =>
    rows.filter((row) => row.commitState === "committed").length;

  return (
    <div className="flex min-w-0 flex-col gap-5">
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
          <SiteAvatar host={host} size="lg" />
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
        </div>
      </section>

      {findings.error !== null ? (
        <Panel>
          <ErrorRows
            title="This host's rows could not be loaded."
            message={findings.error}
            onRetry={findings.retry}
          />
        </Panel>
      ) : ready && findings.rows.length === 0 ? (
        <Panel>
          <EmptyRows message="No recorded rows for this host." />
        </Panel>
      ) : (
        <div className="reveal-swap">
          <DetailSkeleton />
          {ready ? (
            <div className="flex flex-col gap-5">
              {findings.complete ? null : (
                <Banner status="info" contrast="high" size="compact">
                  <BannerTitle>
                    Not every row of this host is listed
                  </BannerTitle>
                  <BannerDescription>
                    This page read the first{" "}
                    {SITE_ROW_CAP.toLocaleString("en-US")} rows of this host;
                    the artifact pages list the rest.
                  </BannerDescription>
                </Banner>
              )}
              {presentKinds.length > 1 ? (
                <SizeProvider size="compact">
                  <CountChips
                    label="Evidence kind"
                    total={savedIn(findings.rows)}
                    chips={presentKinds.map(
                      (meta): CountChip => ({
                        key: meta.kind,
                        label: meta.label,
                        count: savedIn(grouped.get(meta.kind) ?? []),
                      }),
                    )}
                    active={kindFilter}
                    onChange={(key) => {
                      setKindFilter(
                        presentKinds.find((meta) => meta.kind === key)?.kind ??
                          null,
                      );
                    }}
                  />
                </SizeProvider>
              ) : null}
              {presentKinds
                .filter(
                  (meta) => kindFilter === null || kindFilter === meta.kind,
                )
                .map((meta) => (
                  <KindPanel
                    key={meta.kind}
                    meta={meta}
                    rows={grouped.get(meta.kind) ?? []}
                    onSelect={onSelect}
                  />
                ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

/** Below `md`: the host list and the detail are one screen at a time. */
function narrowScreen(): boolean {
  return globalThis.matchMedia("(max-width: 767px)").matches;
}

export function SitesPage() {
  const [search, setSearch] = useState("");
  // The host on show lives in the URL (`host`): an Overview or Related link
  // opens Sites on it, and Back returns to the previous host.
  const [host, setHost] = useViewHost();
  const [selected, setSelected] = useState<SelectedRow | null>(null);
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
          Object.values(right.counts).reduce((sum, n) => sum + n, 0) -
            Object.values(left.counts).reduce((sum, n) => sum + n, 0) ||
          (left.host < right.host ? -1 : left.host > right.host ? 1 : 0),
      ),
    [hosts.rows],
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  // Below `md` the list and the detail are one screen at a time: picking a
  // host swaps the list for its evidence, from the top.
  // Where the list was when a host was picked below `md`: "All hosts" puts
  // the list back at that scroll position with focus on that host's card.
  const listScroll = useRef(0);
  const pickHost = useCallback((next: string) => {
    setHost(next);
    if (narrowScreen()) {
      listScroll.current = window.scrollY;
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ block: "start" });
      });
    }
  }, []);
  const backToHosts = useCallback(() => {
    const previous = host;
    setHost(null);
    requestAnimationFrame(() => {
      window.scrollTo({ top: listScroll.current });
      if (previous !== null) {
        document
          .querySelector<HTMLElement>(
            `[aria-label="${CSS.escape(`Show evidence for ${previous}`)}"]`,
          )
          ?.focus({ preventScroll: true });
      }
    });
  }, [host]);

  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(240px,0.36fr)_minmax(0,1fr)]">
      <HostList
        hosts={hosts.loading ? [] : sortedHosts}
        complete={hosts.complete}
        loading={hosts.loading}
        error={hosts.error}
        onRetry={hosts.retry}
        search={search}
        onSearch={setSearch}
        selected={host}
        onSelect={pickHost}
        className={host === null ? undefined : "max-md:hidden"}
      />
      <div ref={detailRef} className="min-w-0 scroll-mt-16">
        {host === null ? (
          <Panel className="max-md:hidden">
            <EmptyRows
              icon={ARTIFACT_ICONS.sites}
              message="Select a host to view its evidence."
            />
          </Panel>
        ) : (
          <HostDetail
            key={host}
            host={host}
            onSelect={select}
            onBack={backToHosts}
          />
        )}
      </div>
      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={sheetTitle(selected.row)}
          redactedFields={secretFieldsOf(selected.row)}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
