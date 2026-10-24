/**
 * The Sites page.
 *
 * A host-centric read of the evidence: every observed host on the left,
 * ordered by how much recorded evidence it carries, and on the right the
 * selected host's records grouped per artifact kind — each group a curated
 * table with the columns an examiner reads first, not a union of every wire
 * field. Every technical field stays reachable through the row detail sheet.
 *
 * Presentation rules kept: hosts and counts are grouped records, never
 * inference; states are worded, never color alone; an event without its own
 * recorded value shows the word "absent".
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
import { useCallback, useEffect, useMemo, useState } from "react";

import { callApi } from "../api.js";
import { cn } from "../lib.js";
import type {
  Finding,
  PageOf,
  SiteArtifactKind,
  SiteFinding,
  SiteHost,
} from "../types.js";
import { EmptyRows } from "./data-table.js";
import {
  AbsentWord,
  fieldInteger,
  fieldText,
  fieldUtc,
  formatInstant,
  SiteAvatar,
  StateWord,
} from "./finding-fields.js";
import { RowSheet, type SelectedRow } from "./row-sheet.js";
import { Button } from "./compat/button.js";
import { Skeleton } from "./ui/misc.js";

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
  }, [route, key, nonce, enabled]);

  const retry = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { rows, loading, error, retry };
}

function LoadError({
  message,
  onRetry,
}: {
  readonly message: string;
  readonly onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="mx-4 my-4 flex items-start gap-2.5 rounded-md border border-destructive-border bg-destructive-wash px-3.5 py-3"
    >
      <div className="flex-1">
        <p className="text-[13px] font-medium text-destructive">
          The rows could not be loaded.
        </p>
        <p className="text-[12.5px] text-destructive/80">{message}</p>
      </div>
      <Button onClick={onRetry} size="sm" className="shrink-0">
        Retry
      </Button>
    </div>
  );
}

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
    <section className="flex flex-col self-start overflow-hidden rounded-lg border border-border bg-card md:sticky md:top-7">
      <header className="flex items-center gap-2.5 border-b border-border px-4 py-2.5">
        <h2 className="text-[13px] font-semibold">Observed hosts</h2>
        <span className="text-[12px] text-muted-foreground tabular-nums">
          {hosts.length}
        </span>
      </header>
      <div className="border-b border-border/70 p-3">
        <label className="relative block">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(event) => {
              onSearch(event.target.value);
            }}
            placeholder="Search hosts"
            aria-label="Search observed hosts"
            className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-[13px] outline-none focus:ring-2 focus:ring-ring"
          />
        </label>
      </div>
      {error !== null ? (
        <LoadError message={error} onRetry={onRetry} />
      ) : loading && hosts.length === 0 ? (
        <div className="flex flex-col gap-2 p-3" aria-label="Loading hosts">
          {[0, 1, 2, 3, 4].map((index) => (
            <Skeleton key={index} className="h-11 w-full" />
          ))}
        </div>
      ) : hosts.length === 0 ? (
        <EmptyRows message="No observed hosts match this search." />
      ) : (
        <div className="flex flex-col p-2 md:max-h-[calc(100dvh-220px)] md:overflow-y-auto">
          {hosts.map((item) => {
            const active = selected === item.host;
            return (
              <button
                key={item.host}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  onSelect(item.host);
                }}
                className={cn(
                  "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-100",
                  active ? "bg-accent" : "hover:bg-muted",
                )}
              >
                <SiteAvatar host={item.host} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span
                    className={cn(
                      "truncate text-[12.5px] font-medium",
                      active && "text-accent-foreground",
                    )}
                  >
                    {item.host}
                  </span>
                  <span className="truncate text-[11.5px] text-muted-foreground">
                    {KIND_META.filter((meta) => item.counts[meta.kind] > 0)
                      .map(
                        (meta) =>
                          `${String(item.counts[meta.kind])} ${meta.label.toLowerCase()}`,
                      )
                      .join(" · ")}
                  </span>
                </span>
                <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground tabular-nums">
                  {totalOf(item)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------- per-kind curated tables ------------------------- */

function TimeParts({ utc }: { readonly utc: string | null }) {
  const parts = utc === null ? null : formatInstant(utc);
  if (utc === null || parts === null) {
    return <AbsentWord />;
  }
  return (
    <span
      className="text-[12.5px] whitespace-nowrap tabular-nums"
      title={`${utc} (UTC)`}
    >
      <span className="font-medium">{parts.date}</span>
      <span className="ml-2 text-[12px] text-muted-foreground">
        {parts.time}
      </span>
    </span>
  );
}

function TwoLine({
  primary,
  secondary,
  mono = false,
}: {
  readonly primary: string | null;
  readonly secondary: string | null;
  readonly mono?: boolean;
}) {
  const headline = primary ?? secondary;
  const subline = primary === null ? null : secondary;
  if (headline === null) {
    return <AbsentWord />;
  }
  return (
    <span className="flex min-w-0 flex-col">
      <span
        className={cn(
          "truncate text-[13px] text-foreground/90",
          mono && "font-mono text-[12.5px]",
        )}
        title={headline}
      >
        {headline}
      </span>
      {subline === null || subline === headline ? null : (
        <span
          className="truncate font-mono text-[11.5px] text-muted-foreground"
          title={subline}
        >
          {subline}
        </span>
      )}
    </span>
  );
}

/** One curated column of a per-kind table. */
interface KindColumn {
  readonly label: string;
  readonly cell: (row: SiteFinding) => React.ReactNode;
}

const TIME_CELL = (field: string): KindColumn["cell"] =>
  function TimeCell(row: SiteFinding) {
    return <TimeParts utc={fieldUtc(row.fields[field])} />;
  };

/**
 * The first column for each kind. Chosen for reading, not completeness:
 * the host itself is already fixed by the selection, so cells carry what
 * distinguishes rows within the host.
 */
const KIND_COLUMNS: Readonly<Record<SiteArtifactKind, readonly KindColumn[]>> =
  {
    visits: [
      { label: "Time", cell: TIME_CELL("visitTime") },
      {
        label: "Page",
        cell: (row) => (
          <TwoLine
            primary={fieldText(row.fields.title)}
            secondary={fieldText(row.fields.url)}
          />
        ),
      },
    ],
    cookies: [
      {
        label: "Cookie",
        cell: (row) => (
          <TwoLine
            primary={fieldText(row.fields.name)}
            secondary={fieldText(row.fields.path)}
            mono
          />
        ),
      },
      { label: "Created", cell: TIME_CELL("creationTime") },
      { label: "Expires", cell: TIME_CELL("expiresTime") },
    ],
    saved_logins: [
      {
        label: "Username",
        cell: (row) => (
          <TwoLine
            primary={fieldText(row.fields.usernameValue)}
            secondary={fieldText(row.fields.signonRealm)}
            mono
          />
        ),
      },
      { label: "Created", cell: TIME_CELL("dateCreated") },
      { label: "Last used", cell: TIME_CELL("dateLastUsed") },
    ],
    bookmarks: [
      {
        label: "Bookmark",
        cell: (row) => (
          <TwoLine
            primary={fieldText(row.fields.name)}
            secondary={fieldText(row.fields.url)}
          />
        ),
      },
      {
        label: "Folder",
        cell: (row) => {
          const folder = fieldText(row.fields.folderPath);
          return folder === null ? (
            <AbsentWord />
          ) : (
            <span className="text-[12.5px] text-muted-foreground">
              {folder}
            </span>
          );
        },
      },
      { label: "Added", cell: TIME_CELL("dateAdded") },
    ],
    top_sites: [
      {
        label: "Rank",
        cell: (row) => {
          const rank = fieldInteger(row.fields.urlRank);
          return rank === null ? (
            <AbsentWord />
          ) : (
            <span className="text-[13px] font-semibold text-muted-foreground tabular-nums">
              {rank}
            </span>
          );
        },
      },
      {
        label: "Site",
        cell: (row) => (
          <TwoLine
            primary={fieldText(row.fields.title)}
            secondary={fieldText(row.fields.url)}
          />
        ),
      },
    ],
    form_data: [
      {
        label: "Field",
        cell: (row) => (
          <TwoLine
            primary={fieldText(row.fields.fieldName)}
            secondary={fieldText(row.fields.fieldValue)}
            mono
          />
        ),
      },
      { label: "Last used", cell: TIME_CELL("dateLastUsed") },
    ],
  };

function KindTable({
  kind,
  rows,
  onSelect,
}: {
  readonly kind: SiteArtifactKind;
  readonly rows: readonly SiteFinding[];
  readonly onSelect: (row: Finding) => void;
}) {
  const columns = KIND_COLUMNS[kind];
  return (
    <div className="fx-scroll-x">
      <table className="w-full text-left text-[13px]">
        <thead>
          <tr>
            {[...columns.map((column) => column.label), "State"].map(
              (label) => (
                <th
                  key={label}
                  className="border-b border-border bg-muted/50 px-3 py-2 text-left text-[11px] font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase"
                >
                  {label}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr
              key={index}
              tabIndex={0}
              aria-label={`Open ${KIND_LABELS[kind]} row detail`}
              onClick={() => {
                onSelect(row);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelect(row);
                }
              }}
              className="cursor-pointer border-b border-border/70 transition-colors duration-100 last:border-b-0 hover:bg-accent/40"
            >
              {columns.map((column) => (
                <td
                  key={column.label}
                  className="max-w-[380px] px-3 py-2.5 first:whitespace-nowrap"
                >
                  {column.cell(row)}
                </td>
              ))}
              <td className="w-32 px-3 py-2.5">
                <StateWord state={row.commitState} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------- host detail ------------------------------- */

function SiteHeroMetric({
  label,
  value,
  detail,
}: {
  readonly label: string;
  readonly value: string;
  readonly detail: string;
}) {
  return (
    <div className="flex min-w-[110px] flex-col">
      <dt className="text-[10px] font-semibold tracking-[0.11em] text-blue-100/80 uppercase">
        {label}
      </dt>
      <dd className="mt-2 text-[28px] leading-none font-semibold tracking-[-0.04em] tabular-nums">
        {value}
      </dd>
      <span className="mt-1.5 text-[11.5px] text-blue-100/80">{detail}</span>
    </div>
  );
}

function HostDetail({
  host,
  hostMeta,
  onSelect,
}: {
  readonly host: string;
  readonly hostMeta: SiteHost | undefined;
  readonly onSelect: (row: Finding) => void;
}) {
  const findings = useSiteList<SiteFinding>(
    "site-findings",
    [["host", host]],
    true,
  );
  const [kindFilter, setKindFilter] = useState<SiteArtifactKind | null>(null);

  // Selecting another host resets the kind focus — the chips describe the
  // new host's evidence, not the previous one's.
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
  const recordedRows = hostMeta === undefined ? findings.rows.length : totalOf(hostMeta);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <section className="fx-hero relative overflow-hidden rounded-2xl text-white">
        <div className="relative flex flex-col gap-6 px-5 pt-5 pb-7 sm:px-6 sm:pt-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
            <div className="flex min-w-0 items-start gap-3.5">
              <span className="mt-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20">
                <SiteAvatar host={host} size="md" />
              </span>
              <div className="min-w-0">
                <p className="text-[10px] font-semibold tracking-[0.12em] text-blue-100/80 uppercase">
                  Observed host
                </p>
                <h2 className="mt-1 truncate font-mono text-[21px] font-semibold tracking-[-0.02em]">
                  {host}
                </h2>
                <p className="mt-1 text-[12px] text-blue-100/80">
                  Recorded evidence grouped by artifact kind.
                </p>
              </div>
            </div>
            {presentKinds.length > 1 ? (
              <div className="flex flex-wrap items-center gap-1.5 lg:max-w-[58%] lg:justify-end">
                <button
                  type="button"
                  aria-pressed={kindFilter === null}
                  onClick={() => {
                    setKindFilter(null);
                  }}
                  className={cn(
                    "inline-flex h-7 cursor-pointer items-center rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150",
                    kindFilter === null
                      ? "border-white bg-white text-blue-700"
                      : "border-white/20 bg-black/10 text-white/80 hover:bg-white/10 hover:text-white",
                  )}
                >
                  All
                </button>
                {presentKinds.map((meta) => (
                  <button
                    key={meta.kind}
                    type="button"
                    aria-pressed={kindFilter === meta.kind}
                    onClick={() => {
                      setKindFilter(kindFilter === meta.kind ? null : meta.kind);
                    }}
                    className={cn(
                      "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-colors duration-150",
                      kindFilter === meta.kind
                        ? "border-white bg-white text-blue-700"
                        : "border-white/20 bg-black/10 text-white/80 hover:bg-white/10 hover:text-white",
                    )}
                  >
                    {meta.label}
                    <span className="tabular-nums opacity-70">
                      {(grouped.get(meta.kind) ?? []).length}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <dl className="flex flex-wrap gap-x-9 gap-y-5">
            <SiteHeroMetric
              label="Recorded rows"
              value={recordedRows.toLocaleString("en-US")}
              detail="across this host"
            />
            <SiteHeroMetric
              label="Evidence kinds"
              value={String(presentKinds.length)}
              detail="recorded artifact types"
            />
            <SiteHeroMetric
              label="Recovered"
              value={recoveredCount.toLocaleString("en-US")}
              detail="from WAL or journal"
            />
          </dl>
        </div>
      </section>

      {findings.error !== null ? (
        <LoadError message={findings.error} onRetry={findings.retry} />
      ) : findings.loading && findings.rows.length === 0 ? (
        <div className="flex flex-col gap-2" aria-label="Loading rows">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-[120px] w-full" />
          ))}
        </div>
      ) : findings.rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-[13px] text-muted-foreground">
          No recorded rows for this host.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {presentKinds
            .filter((meta) => kindFilter === null || kindFilter === meta.kind)
            .map((meta) => {
              const rows = grouped.get(meta.kind) ?? [];
              const Icon = meta.icon;
              return (
                <section
                  key={meta.kind}
                  className="overflow-hidden rounded-lg border border-border bg-card"
                >
                  <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
                    <span className="inline-flex size-6 items-center justify-center rounded-md bg-muted">
                      <Icon
                        aria-hidden="true"
                        className="size-3.5 text-foreground/60"
                      />
                    </span>
                    <h3 className="text-[13px] font-semibold">{meta.label}</h3>
                    <span className="text-[12px] text-muted-foreground tabular-nums">
                      {rows.length}
                    </span>
                  </header>
                  <KindTable
                    kind={meta.kind}
                    rows={rows}
                    onSelect={onSelect}
                  />
                </section>
              );
            })}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- page ---------------------------------- */

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
  const hosts = useSiteList<SiteHost>(
    "site-hosts",
    search.length === 0 ? [] : [["search", search]],
    true,
  );

  const select = useCallback((row: Finding) => {
    setSelected({ kind: "finding", row });
  }, []);

  return (
    <div className="grid items-start gap-4 md:grid-cols-[minmax(220px,0.36fr)_minmax(0,1fr)]">
      <HostList
        hosts={hosts.rows}
        loading={hosts.loading}
        error={hosts.error}
        onRetry={hosts.retry}
        search={search}
        onSearch={setSearch}
        selected={host}
        onSelect={setHost}
      />
      {host === null ? (
        <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <Globe
            aria-hidden="true"
            className="size-6 text-muted-foreground/40"
          />
          <p className="text-[13px] text-muted-foreground">
            Select a recorded host to view its evidence.
          </p>
        </div>
      ) : (
        <HostDetail
          host={host}
          hostMeta={hosts.rows.find((item) => item.host === host)}
          onSelect={select}
        />
      )}
      {selected !== null ? (
        <RowSheet
          selected={selected}
          onClose={() => {
            setSelected(null);
          }}
        />
      ) : null}
    </div>
  );
}
