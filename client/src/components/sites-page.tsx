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

import { Panel, PanelHeader, PanelTitle } from "@/components/panel";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import {
  ARTIFACT_ICONS,
  ChevronLeftIcon,
  SearchIcon,
  type AppIcon,
} from "@/lib/app-icons";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type {
  Finding,
  PageOf,
  SiteArtifactKind,
  SiteFinding,
  SiteHost,
} from "../types.js";
import {
  CARD_TITLE_CLEAR,
  CommitStateSplit,
  Count,
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
  SiteAvatar,
  StateWord,
  TwoLineCell,
} from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
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

function totalOf(host: SiteHost): number {
  return Object.values(host.counts).reduce((sum, count) => sum + count, 0);
}

/** One list read; the mock and the future real route both return one page. */
function useSiteList<Row>(
  route: string,
  parameters: readonly (readonly [string, string])[],
  enabled: boolean,
) {
  const [rows, setRows] = useState<readonly Row[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(parameters);

  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      setRows([]);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }
    setLoading(true);
    setError(null);
    callApi<PageOf<Row>>(route, parameters)
      .then((page) => {
        if (cancelled) {
          return;
        }
        setRows(page.items);
        setLoading(false);
      })
      .catch((requestError: unknown) => {
        if (cancelled) {
          return;
        }
        setError(
          requestError instanceof Error
            ? requestError.message
            : "Request failed.",
        );
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `key` stands in for `parameters`, whose identity changes every render.
  }, [route, key, nonce, enabled]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, loading, error, retry };
}

/* -------------------------------- host list -------------------------------- */

/** "4 visits · 1 cookie" — the kinds a host carries, in reading order. */
function hostSummary(host: SiteHost): string {
  return KIND_META.filter((meta) => host.counts[meta.kind] > 0)
    .map((meta) => plural(host.counts[meta.kind], meta.one, meta.many))
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
}: {
  readonly hosts: readonly SiteHost[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly selected: string | null;
  readonly onSelect: (host: string) => void;
  readonly className?: string;
}) {
  return (
    <Panel
      role="region"
      aria-labelledby="sites-hosts-title"
      className={cn("overflow-clip md:sticky md:top-16", className)}
    >
      <PanelHeader className="items-center pb-3">
        <div className="flex items-center gap-2">
          <PanelTitle id="sites-hosts-title">Observed hosts</PanelTitle>
          <Count>{hosts.length}</Count>
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
                  label={`Show evidence for ${item.host}`}
                  selected={selected === item.host}
                  onClick={() => {
                    onSelect(item.host);
                  }}
                >
                  <SiteAvatar host={item.host} />
                  <CardHeader>
                    <CardTitle className={CARD_TITLE_CLEAR} title={item.host}>
                      {item.host}
                    </CardTitle>
                    <CardDescription
                      className={cn(typeClass("caption"), "truncate")}
                    >
                      {hostSummary(item)}
                    </CardDescription>
                  </CardHeader>
                  <CardFooter className="pointer-events-none">
                    <Count>{totalOf(item)}</Count>
                  </CardFooter>
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
  className: "max-w-[420px] min-w-[220px]",
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
        cell: (row) => <FieldCell field={row.fields.fieldName} />,
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
  cell: (row) => row.profile,
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
  showProfile,
  onSelect,
}: {
  readonly meta: (typeof KIND_META)[number];
  readonly rows: readonly SiteFinding[];
  readonly showProfile: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  const { saved, recovered } = splitByCommit(rows);
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
            <EmptyRows
              className="py-6"
              message="No saved rows: every row of this kind for this host was recovered."
            />
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
  const findings = useSiteList<SiteFinding>(
    "site-findings",
    [["host", host]],
    true,
  );
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
  const profileCount = new Set(findings.rows.map((row) => row.profile)).size;
  const ready = !(findings.loading && findings.rows.length === 0);

  const tabIndex =
    kindFilter === null
      ? 0
      : presentKinds.findIndex((meta) => meta.kind === kindFilter) + 1;

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
              {presentKinds.length > 1 ? (
                <TabsSubtle
                  idPrefix="site-kinds"
                  size="compact"
                  selectedIndex={Math.max(0, tabIndex)}
                  onSelect={(index) => {
                    setKindFilter(
                      index === 0
                        ? null
                        : (presentKinds[index - 1]?.kind ?? null),
                    );
                  }}
                >
                  <TabsSubtleItem
                    index={0}
                    label={`All ${String(findings.rows.length)}`}
                  />
                  {presentKinds.map((meta, index) => (
                    <TabsSubtleItem
                      key={meta.kind}
                      index={index + 1}
                      icon={meta.icon}
                      label={`${meta.label} ${String((grouped.get(meta.kind) ?? []).length)}`}
                    />
                  ))}
                </TabsSubtle>
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
                    showProfile={profileCount > 1}
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

export function SitesPage({
  initialHost,
}: {
  /** Preselects a host on mount — the Overview's Top sites card jumps here
   *  with the row's own host instead of landing on an empty selection. */
  readonly initialHost?: string | null;
}) {
  const [search, setSearch] = useState("");
  const [host, setHost] = useState<string | null>(initialHost ?? null);
  const [selected, setSelected] = useState<SelectedRow | null>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const hosts = useSiteList<SiteHost>(
    "site-hosts",
    search.length === 0 ? [] : [["search", search]],
    true,
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  // Below `md` the list and the detail are one screen at a time: picking a
  // host swaps the list for its evidence, from the top.
  const pickHost = useCallback((next: string) => {
    setHost(next);
    if (narrowScreen()) {
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ block: "start" });
      });
    }
  }, []);
  const backToHosts = useCallback(() => {
    setHost(null);
  }, []);

  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(240px,0.36fr)_minmax(0,1fr)]">
      <HostList
        hosts={hosts.rows}
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
