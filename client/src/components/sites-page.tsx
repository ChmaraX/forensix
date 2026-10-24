/**
 * The Sites page.
 *
 * A host-centric read of the evidence, as a master–detail pair: every
 * observed host on the left, ordered by how much recorded evidence it
 * carries, as an FF card list (one fluid hover highlight, the selected host
 * holding the selection fill); on the right the selected host's records,
 * grouped per artifact kind — each group an FF Table with the columns an
 * examiner reads first, not a union of every wire field. Every technical
 * field stays reachable through the row detail sheet.
 *
 * Presentation rules kept: hosts and counts are grouped records, never
 * inference; states are worded, never colour alone; a field without its own
 * recorded value shows its own word ("(empty)", "absent", "unavailable");
 * within each kind, rows recovered from the WAL / rollback journal are a
 * separate list from saved rows (the stacked CommitStateSplit), never sorted
 * in, and the host's figures count saved and recovered rows apart.
 */
import {
  Bookmark,
  ClipboardList,
  Cookie,
  Globe,
  KeyRound,
  Search,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { Panel, PanelHeader, PanelTitle } from "@/components/panel";
import {
  Card,
  CardDescription,
  CardFooter,
  CardGroup,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/misc";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TabsSubtle, TabsSubtleItem } from "@/components/ui/tabs-subtle";
import { fontWeights } from "@/lib/font-weight";
import { SizeProvider, typeClass } from "@/lib/size-context";
import { cn } from "@/lib/utils";

import { callApi } from "../api.js";
import type {
  CaseCompleteness,
  Finding,
  PageOf,
  SiteArtifactKind,
  SiteFinding,
  SiteHost,
} from "../types.js";
import { CompletenessPanel, SITES_COVERAGE } from "./completeness.js";
import {
  CARD_TITLE_CLEAR,
  CommitStateSplit,
  Count,
  IconTile,
  splitByCommit,
  TimeCell,
} from "./page-kit.js";
import { activateOnKey, EmptyRows, ROW_FOCUS_CLASS } from "./data-table.js";
import { FieldCell, SiteAvatar, StateWord } from "./finding-fields.js";
import { FilterTextField } from "./filters.js";
import { ErrorRows, LoadingRows } from "./list-states.js";
import { MetricBand, MetricBandItem } from "./metric-band.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";

/**
 * Reading order, labels, and icons for the six site artifact kinds. Order is
 * investigative: activity first, then stored identity data.
 */
const KIND_META: readonly {
  readonly kind: SiteArtifactKind;
  readonly label: string;
  readonly icon: LucideIcon;
}[] = [
  { kind: "visits", label: "Visits", icon: Globe },
  { kind: "cookies", label: "Cookies", icon: Cookie },
  { kind: "saved_logins", label: "Saved logins", icon: KeyRound },
  { kind: "bookmarks", label: "Bookmarks", icon: Bookmark },
  { kind: "top_sites", label: "Top sites", icon: TrendingUp },
  { kind: "form_data", label: "Form data", icon: ClipboardList },
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
    .map(
      (meta) =>
        `${String(host.counts[meta.kind])} ${meta.label.toLocaleLowerCase("en-US")}`,
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
}: {
  readonly hosts: readonly SiteHost[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly onRetry: () => void;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly selected: string | null;
  readonly onSelect: (host: string) => void;
}) {
  return (
    <Panel
      role="region"
      aria-labelledby="sites-hosts-title"
      className="overflow-clip md:sticky md:top-16"
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
            icon={Search}
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
        <div className="scroll-fade max-h-[45dvh] overflow-y-auto p-1 md:max-h-[calc(100dvh-13rem)]">
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

/** One curated column of a per-kind table. */
interface KindColumn {
  readonly label: string;
  /** Right-align numeric columns. */
  readonly numeric?: boolean;
  /** The column the row reads by (foreground, not muted). */
  readonly lead?: boolean;
  readonly cell: (row: SiteFinding) => ReactNode;
}

const timeColumn = (label: string, field: string): KindColumn => ({
  label,
  cell: (row) => <TimeCell field={row.fields[field]} />,
});

const textColumn = (
  label: string,
  field: string,
  options: { readonly lead?: boolean; readonly prose?: boolean } = {},
): KindColumn => ({
  label,
  lead: options.lead,
  // Raw values (URLs, names, paths) stay mono; prose (titles, folders) reads
  // in the body face. Every other state keeps its own word either way.
  cell: (row) => (
    <FieldCell
      field={row.fields[field]}
      format={options.prose === true ? (value) => String(value) : undefined}
    />
  ),
});

/**
 * The columns for each kind. Chosen for reading, not completeness: the host
 * itself is already fixed by the selection, so cells carry what distinguishes
 * rows within the host. Each field keeps its own column, so a missing title
 * reads "absent" in its own cell instead of being papered over by the URL.
 */
const KIND_COLUMNS: Readonly<Record<SiteArtifactKind, readonly KindColumn[]>> =
  {
    visits: [
      timeColumn("Time", "visitTime"),
      textColumn("Title", "title", { lead: true, prose: true }),
      textColumn("URL", "url"),
    ],
    cookies: [
      textColumn("Cookie", "name", { lead: true }),
      textColumn("Path", "path"),
      timeColumn("Created", "creationTime"),
      timeColumn("Expires", "expiresTime"),
    ],
    saved_logins: [
      textColumn("Username", "usernameValue", { lead: true }),
      textColumn("Sign-on realm", "signonRealm"),
      timeColumn("Created", "dateCreated"),
      timeColumn("Last used", "dateLastUsed"),
    ],
    bookmarks: [
      textColumn("Bookmark", "name", { lead: true, prose: true }),
      textColumn("URL", "url"),
      textColumn("Folder", "folderPath", { prose: true }),
      timeColumn("Added", "dateAdded"),
    ],
    top_sites: [
      {
        label: "Rank",
        numeric: true,
        cell: (row) => (
          <FieldCell
            field={row.fields.urlRank}
            format={(value) => String(value)}
          />
        ),
      },
      textColumn("Title", "title", { lead: true, prose: true }),
      textColumn("URL", "url"),
    ],
    form_data: [
      textColumn("Field", "fieldName", { lead: true }),
      textColumn("Value", "fieldValue"),
      timeColumn("Last used", "dateLastUsed"),
    ],
  };

function KindTable({
  kind,
  rows,
  showState,
  onSelect,
}: {
  readonly kind: SiteArtifactKind;
  readonly rows: readonly SiteFinding[];
  readonly showState: boolean;
  readonly onSelect: (row: Finding) => void;
}) {
  const columns = KIND_COLUMNS[kind];
  return (
    <div className="scroll-fade-x overflow-x-auto px-1 py-1 [&_tbody>tr:last-child]:border-transparent">
      <Table className="tabular-nums">
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead
                key={column.label}
                className={cn(
                  "whitespace-nowrap",
                  column.numeric === true && "text-right",
                )}
              >
                {column.label}
              </TableHead>
            ))}
            <TableHead className="whitespace-nowrap">Profile</TableHead>
            {showState ? (
              <TableHead className="whitespace-nowrap">State</TableHead>
            ) : null}
          </TableRow>
        </TableHeader>
        <TableBody className="reveal-items">
          {rows.map((row, index) => {
            const open = () => {
              onSelect(row);
            };
            return (
              <TableRow
                key={index}
                index={index}
                tabIndex={0}
                aria-label={`Open ${KIND_LABELS[kind]} row detail`}
                onClick={open}
                onKeyDown={(event) => {
                  activateOnKey(event, open);
                }}
                className={ROW_FOCUS_CLASS}
              >
                {columns.map((column) => (
                  <TableCell
                    key={column.label}
                    className={cn(
                      "max-w-[300px]",
                      column.lead === true && "text-foreground",
                      column.numeric === true && "w-16 text-right",
                    )}
                  >
                    {column.cell(row)}
                  </TableCell>
                ))}
                <TableCell className="whitespace-nowrap">
                  {row.profile}
                </TableCell>
                {showState ? (
                  <TableCell>
                    <StateWord state={row.commitState} />
                  </TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
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
  const titleId = `sites-kind-${meta.kind}`;
  return (
    <Panel role="region" aria-labelledby={titleId} className="overflow-clip">
      <PanelHeader className="items-center pb-2">
        <div className="flex items-center gap-3">
          <IconTile icon={meta.icon} />
          {/* Under the host's h2: a third-level heading. */}
          <PanelTitle id={titleId} role="heading" aria-level={3}>
            {meta.label}
          </PanelTitle>
          <Count>
            {`${saved.length.toLocaleString("en-US")} saved`}
            {recovered.length === 0
              ? ""
              : ` · ${recovered.length.toLocaleString("en-US")} recovered`}
          </Count>
        </div>
      </PanelHeader>
      <CommitStateSplit
        variant="stacked"
        savedCount={saved.length}
        recoveredCount={recovered.length}
        saved={
          saved.length > 0 ? (
            <KindTable
              kind={meta.kind}
              rows={saved}
              showState={false}
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
            showState
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
}: {
  readonly host: string;
  readonly onSelect: (row: Finding) => void;
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
  const recoveredCount = findings.rows.filter(
    (row) => row.commitState !== "committed",
  ).length;
  const savedCount = findings.rows.length - recoveredCount;
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
        className="flex min-w-0 flex-col gap-4"
      >
        <div className="flex min-w-0 items-center gap-4 px-1">
          <SiteAvatar host={host} size="lg" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <h2
              id="sites-host-title"
              className={cn(
                typeClass("title"),
                "truncate font-mono text-foreground",
              )}
              style={{ fontVariationSettings: fontWeights.semibold }}
              title={host}
            >
              {host}
            </h2>
            <p className={cn(typeClass("body"), "text-muted-foreground")}>
              Recorded evidence for this host, grouped by artifact kind.
            </p>
          </div>
        </div>
        {findings.error !== null ? null : (
          <div className="reveal-swap">
            <div role="status" aria-label="Loading host figures">
              <Skeleton className="h-[148px] w-full rounded-xl lg:h-[74px]" />
            </div>
            {ready ? (
              <MetricBand className="grid-cols-2 lg:grid-cols-4">
                <MetricBandItem
                  label="Saved rows"
                  value={savedCount.toLocaleString("en-US")}
                  detail="committed rows"
                />
                <MetricBandItem
                  label="Recovered rows"
                  value={recoveredCount.toLocaleString("en-US")}
                  detail="from WAL or journal"
                />
                <MetricBandItem
                  label="Evidence kinds"
                  value={presentKinds.length.toLocaleString("en-US")}
                  detail="recorded artifact types"
                />
                <MetricBandItem
                  label="Profiles"
                  value={profileCount.toLocaleString("en-US")}
                  detail="with rows for this host"
                />
              </MetricBand>
            ) : null}
          </div>
        )}
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

export function SitesPage({
  initialHost,
  completeness,
}: {
  /** The Case's Completeness Statement (the shell reads it once). */
  readonly completeness: CaseCompleteness;
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

  // On a narrow screen the detail sits below the host list, so picking a
  // host brings its evidence into view instead of leaving it off-screen.
  const pickHost = useCallback((next: string) => {
    setHost(next);
    if (globalThis.matchMedia("(max-width: 767px)").matches) {
      requestAnimationFrame(() => {
        detailRef.current?.scrollIntoView({ block: "start" });
      });
    }
  }, []);

  return (
    <div className="grid items-start gap-5 md:grid-cols-[minmax(240px,0.36fr)_minmax(0,1fr)]">
      <CompletenessPanel
        completeness={completeness}
        artifacts={SITES_COVERAGE}
        className="md:col-span-2"
      />
      <HostList
        hosts={hosts.rows}
        loading={hosts.loading}
        error={hosts.error}
        onRetry={hosts.retry}
        search={search}
        onSearch={setSearch}
        selected={host}
        onSelect={pickHost}
      />
      <div ref={detailRef} className="min-w-0 scroll-mt-16">
        {host === null ? (
          <Panel>
            <EmptyRows
              icon={Globe}
              title="No host selected"
              message="Select a recorded host to view its evidence."
            />
          </Panel>
        ) : (
          <HostDetail key={host} host={host} onSelect={select} />
        )}
      </div>
      {selected !== null ? (
        <RowSheet
          selected={selected}
          title={sheetTitle(selected.row)}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
